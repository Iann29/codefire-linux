import crypto from 'crypto'
import os from 'os'
import {
  ProviderHttpError,
  type ProviderAdapter,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatCompletionToolCall,
  type ModelInfo,
  type ProviderHealth,
} from './BaseProvider'
import type { OAuthEngine } from './OAuthEngine'
import { OPENAI_OAUTH } from './oauth-configs'

const PROVIDER_ID = 'openai-subscription'

/** ChatGPT Codex responses endpoint (subscription-based calls via ChatGPT backend) */
const CODEX_ENDPOINT = OPENAI_OAUTH.chatgptCodexUrl || 'https://chatgpt.com/backend-api/codex/responses'

/** Fallback: standard OpenAI API (used for listModels / healthCheck) */
const API_BASE = OPENAI_OAUTH.apiBaseUrl

// ─── Responses API stream event types ─────────────────────────────────────

interface ParsedStreamResult {
  textContent: string
  toolCalls: Array<{ callId: string; name: string; arguments: string }>
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
}

// ─── Adapter ──────────────────────────────────────────────────────────────

export class OpenAISubscriptionAdapter implements ProviderAdapter {
  readonly id = PROVIDER_ID
  readonly name = 'ChatGPT (Subscription)'
  readonly accountIndex: number

  constructor(private readonly oauthEngine: OAuthEngine, accountIndex: number = 0) {
    this.accountIndex = accountIndex
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) throw new Error('OpenAI subscription not connected. Please sign in via Settings > Engine.')

    // Get account ID for ChatGPT-Account-Id header
    const accountId = this.oauthEngine.getAccountId(PROVIDER_ID, this.accountIndex)

    // Convert Chat Completions messages → Responses API format
    const { instructions, input } = convertMessagesToResponsesFormat(request.messages)

    // Convert tools: Chat Completions wraps in {type:"function", function:{...}}
    // Responses API uses flat {type:"function", name:..., ...}
    const tools = request.tools?.map((t) => {
      const fn = (t as Record<string, unknown>).function as Record<string, unknown> | undefined
      if (fn) {
        return { type: 'function', name: fn.name, description: fn.description, parameters: fn.parameters, strict: fn.strict }
      }
      return t
    })

    const body: Record<string, unknown> = {
      model: stripPrefix(request.model),
      instructions,
      input,
      store: false,
      stream: true,
    }

    if (tools?.length) body.tools = tools
    // Note: Responses API doesn't support temperature in the same way as Chat Completions.
    // We omit it since the Codex endpoint may not accept it.

    // Build headers matching the working intent-prompt-mvp flow
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
      'User-Agent': `codefire/1.0.0 (${os.platform()} ${os.release()}; ${os.arch()})`,
      originator: 'opencode',
      session_id: crypto.randomUUID(),
    }

    if (accountId) headers['ChatGPT-Account-Id'] = accountId

    const res = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new ProviderHttpError(
        `OpenAI ChatGPT error: ${text.slice(0, 400)}`,
        res.status,
        res.headers,
      )
    }

    // Parse streaming SSE response (same approach as intent-prompt-mvp)
    const result = await extractFromEventStream(res)

    // Convert to Chat Completions format for the rest of the app
    return toCompletionsResponse(result)
  }

  async listModels(): Promise<ModelInfo[]> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return []

    try {
      const res = await fetch(`${API_BASE}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) return this.defaultModels()

      const json = (await res.json()) as { data?: Array<{ id: string }> }
      if (!json.data?.length) return this.defaultModels()

      // Filter to chat models only
      const chatModels = json.data
        .filter((m) => m.id.startsWith('gpt-') || m.id.startsWith('o') || m.id.startsWith('chatgpt-'))
        .slice(0, 20)
        .map((m) => ({ id: m.id, name: m.id }))

      return chatModels.length > 0 ? chatModels : this.defaultModels()
    } catch {
      return this.defaultModels()
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return { ok: false, error: 'Not connected' }

    const start = Date.now()
    try {
      const res = await fetch(`${API_BASE}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: res.ok, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
    }
  }

  private defaultModels(): ModelInfo[] {
    return [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'o3', name: 'o3' },
      { id: 'o4-mini', name: 'o4-mini' },
    ]
  }
}

// ─── Message format conversion ────────────────────────────────────────────

/**
 * Convert Chat Completions messages array → Responses API format.
 *
 * Chat Completions uses:
 *   [{role: "system", content: "..."}, {role: "user", content: "..."}, ...]
 *
 * Responses API uses:
 *   instructions: "..." (system prompt)
 *   input: [{role: "user", content: [{type: "input_text", text: "..."}]}, ...]
 */
function convertMessagesToResponsesFormat(messages: Array<Record<string, unknown>>): {
  instructions: string
  input: Array<Record<string, unknown>>
} {
  let instructions = ''
  const input: Array<Record<string, unknown>> = []

  for (const msg of messages) {
    const role = msg.role as string
    const content = msg.content

    if (role === 'system') {
      // System messages become instructions
      instructions += (instructions ? '\n\n' : '') + stringifyContent(content)
      continue
    }

    if (role === 'user') {
      input.push({
        role: 'user',
        content: [{ type: 'input_text', text: stringifyContent(content) }],
      })
      continue
    }

    if (role === 'assistant') {
      // Assistant messages with tool_calls → function_call items
      const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown>
          input.push({
            type: 'function_call',
            call_id: tc.id as string,
            name: fn.name as string,
            arguments: fn.arguments as string,
          })
        }
        // Also include text content if present alongside tool calls
        if (content) {
          input.push({
            role: 'assistant',
            content: [{ type: 'output_text', text: stringifyContent(content) }],
          })
        }
      } else {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: stringifyContent(content) }],
        })
      }
      continue
    }

    if (role === 'tool') {
      // Tool results → function_call_output items
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id as string,
        output: stringifyContent(content),
      })
      continue
    }
  }

  return { instructions, input }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    // Handle multi-part content [{type: "text", text: "..."}, ...]
    return content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }
  return String(content)
}

// ─── SSE Stream Parser ────────────────────────────────────────────────────

/**
 * Parse Server-Sent Events stream from the Responses API.
 * Extracts text content, tool calls, and usage from the event stream.
 *
 * Matches the extractTextFromEventStream() approach in intent-prompt-mvp.
 */
async function extractFromEventStream(response: Response): Promise<ParsedStreamResult> {
  const body = response.body
  if (!body) throw new Error('Response body is null')

  const decoder = new TextDecoder()
  let buffer = ''
  let collectedText = ''
  const toolCallsMap = new Map<string, { callId: string; name: string; arguments: string }>()
  let usage: ParsedStreamResult['usage'] = null

  const reader = body.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')

        // Extract "data:" lines from the SSE event
        const data = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
          .trim()

        if (!data || data === '[DONE]') continue

        let event: Record<string, unknown>
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }

        const type = event.type as string

        // Handle errors
        if (type === 'error') {
          const msg = (event.message as string) || (event.error as Record<string, unknown>)?.message || data
          throw new Error(`OpenAI stream error: ${msg}`)
        }

        // Accumulate text deltas
        if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
          collectedText += event.delta
        }

        // Track function calls
        if (type === 'response.output_item.added') {
          const item = event.item as Record<string, unknown> | undefined
          if (item?.type === 'function_call') {
            const callId = (item.call_id as string) || (item.id as string) || ''
            toolCallsMap.set(callId, {
              callId,
              name: (item.name as string) || '',
              arguments: '',
            })
          }
        }

        // Accumulate function call argument deltas
        if (type === 'response.function_call_arguments.delta') {
          const callId = (event.call_id as string) || (event.item_id as string) || ''
          const existing = toolCallsMap.get(callId)
          if (existing && typeof event.delta === 'string') {
            existing.arguments += event.delta
          }
        }

        // Function call complete — update with final data
        if (type === 'response.function_call_arguments.done') {
          const callId = (event.call_id as string) || (event.item_id as string) || ''
          const existing = toolCallsMap.get(callId)
          if (existing && typeof event.arguments === 'string') {
            existing.arguments = event.arguments
          }
        }

        // Output item done — capture final function call data
        if (type === 'response.output_item.done') {
          const item = event.item as Record<string, unknown> | undefined
          if (item?.type === 'function_call') {
            const callId = (item.call_id as string) || (item.id as string) || ''
            toolCallsMap.set(callId, {
              callId,
              name: (item.name as string) || toolCallsMap.get(callId)?.name || '',
              arguments: (item.arguments as string) || toolCallsMap.get(callId)?.arguments || '',
            })
          }
        }

        // Extract usage from completed response
        if (type === 'response.completed' || type === 'response.done') {
          const resp = event.response as Record<string, unknown> | undefined
          const u = resp?.usage as Record<string, unknown> | undefined
          if (u) {
            usage = {
              promptTokens: (u.input_tokens as number) || (u.prompt_tokens as number) || 0,
              completionTokens: (u.output_tokens as number) || (u.completion_tokens as number) || 0,
              totalTokens: (u.total_tokens as number) || 0,
            }
            if (!usage.totalTokens) {
              usage.totalTokens = usage.promptTokens + usage.completionTokens
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return {
    textContent: collectedText.trim(),
    toolCalls: Array.from(toolCallsMap.values()),
    usage,
  }
}

// ─── Response conversion ──────────────────────────────────────────────────

/**
 * Convert parsed Responses API result → Chat Completions format.
 * This allows the rest of the Codefire app to consume the response
 * using the standard ChatCompletionResponse interface.
 */
function toCompletionsResponse(parsed: ParsedStreamResult): ChatCompletionResponse {
  const toolCalls: ChatCompletionToolCall[] | undefined =
    parsed.toolCalls.length > 0
      ? parsed.toolCalls.map((tc) => ({
          id: tc.callId,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }))
      : undefined

  return {
    choices: [
      {
        message: {
          content: parsed.textContent || null,
          tool_calls: toolCalls,
        },
      },
    ],
    usage: parsed.usage
      ? {
          prompt_tokens: parsed.usage.promptTokens,
          completion_tokens: parsed.usage.completionTokens,
          total_tokens: parsed.usage.totalTokens,
        }
      : undefined,
    providerId: PROVIDER_ID,
    providerName: 'ChatGPT (Subscription)',
  }
}

function stripPrefix(model: string): string {
  const slash = model.indexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}
