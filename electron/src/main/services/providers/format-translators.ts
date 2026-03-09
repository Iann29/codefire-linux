/**
 * Format translators between the internal OpenAI format and native provider formats.
 *
 * Internal format (BaseProvider.ts): OpenAI Chat Completions API
 * - messages: [{role, content, tool_calls?, tool_call_id?}]
 * - tools: [{type: 'function', function: {name, description, parameters}}]
 * - response: {choices: [{message: {content, tool_calls?}}], usage}
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionToolCall,
} from './BaseProvider'
import { decodeDataUrl } from '@shared/chatAttachments'

// ─── Anthropic Messages API ─────────────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface AnthropicRequest {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
  tools?: AnthropicTool[]
  temperature?: number
  output_config?: {
    effort: 'low' | 'medium' | 'high'
  }
}

interface AnthropicResponse {
  id: string
  content: AnthropicContentBlock[]
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export function openaiToAnthropic(request: ChatCompletionRequest): AnthropicRequest {
  let systemPrompt: string | undefined
  const messages: AnthropicMessage[] = []

  for (const msg of request.messages) {
    const role = msg.role as string

    if (role === 'system') {
      systemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') + String(msg.content ?? '')
      continue
    }

    if (role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      const content = extractOpenAITextContent(msg.content)
      if (content) {
        blocks.push({ type: 'text', text: content })
      }

      const toolCalls = msg.tool_calls as ChatCompletionToolCall[] | undefined
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          let input: unknown = {}
          try { input = JSON.parse(tc.function.arguments) } catch { /* keep empty */ }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
      }

      messages.push({ role: 'assistant', content: blocks.length === 1 && blocks[0].type === 'text' ? (blocks[0].text ?? '') : blocks })
      continue
    }

    if (role === 'tool') {
      // Anthropic expects tool_result blocks inside a 'user' message
      const lastMsg = messages[messages.length - 1]
      const resultBlock: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id as string,
        content: String(msg.content ?? ''),
      }

      // Merge into preceding user message if it already has tool_results
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        (lastMsg.content as AnthropicContentBlock[]).push(resultBlock)
      } else {
        messages.push({ role: 'user', content: [resultBlock] })
      }
      continue
    }

    // 'user' role
    messages.push({ role: 'user', content: toAnthropicUserContent(msg.content) })
  }

  // Anthropic requires alternating user/assistant. Merge consecutive same-role messages.
  const merged = mergeConsecutiveMessages(messages)

  const result: AnthropicRequest = {
    model: stripProviderPrefix(request.model),
    max_tokens: request.maxTokens ?? 4096,
    messages: merged,
    temperature: request.temperature,
  }

  if (systemPrompt) result.system = systemPrompt

  if (request.tools?.length) {
    result.tools = request.tools.map((t) => {
      const fn = (t as Record<string, unknown>).function as Record<string, unknown>
      return {
        name: fn.name as string,
        description: (fn.description as string) ?? '',
        input_schema: (fn.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
      }
    })
  }

  if (
    request.effortLevel &&
    request.effortLevel !== 'default' &&
    (request.effortLevel === 'low' || request.effortLevel === 'medium' || request.effortLevel === 'high')
  ) {
    result.output_config = {
      effort: request.effortLevel,
    }
  }

  return result
}

export function anthropicToOpenai(response: AnthropicResponse): ChatCompletionResponse {
  let textContent = ''
  const toolCalls: ChatCompletionToolCall[] = []

  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      textContent += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'function',
        function: {
          name: block.name ?? '',
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
        },
      })
    }
  }

  return {
    choices: [{
      message: {
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    }],
    usage: {
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
      total_tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      cache_read_tokens: response.usage?.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage?.cache_creation_input_tokens ?? 0,
      source: 'provider',
    },
  }
}

// ─── Gemini GenerativeLanguage API ──────────────────────────────────────────

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  inlineData?: { mimeType: string; data: string }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
  }>
}

interface GeminiRequest {
  contents: GeminiContent[]
  tools?: GeminiTool[]
  systemInstruction?: { parts: GeminiPart[] }
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
  }
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: GeminiPart[] }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

export function openaiToGemini(request: ChatCompletionRequest): GeminiRequest {
  let systemParts: GeminiPart[] | undefined
  const contents: GeminiContent[] = []

  // Track tool_call ids → names for mapping tool results
  const toolCallNames = new Map<string, string>()

  for (const msg of request.messages) {
    const role = msg.role as string

    if (role === 'system') {
      systemParts = [{ text: String(msg.content ?? '') }]
      continue
    }

    if (role === 'assistant') {
      const parts: GeminiPart[] = []
      const textContent = extractOpenAITextContent(msg.content)
      if (textContent) parts.push({ text: textContent })

      const toolCalls = msg.tool_calls as ChatCompletionToolCall[] | undefined
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) as Record<string, unknown> } catch { /* keep empty */ }
          parts.push({ functionCall: { name: tc.function.name, args } })
          toolCallNames.set(tc.id, tc.function.name)
        }
      }

      if (parts.length > 0) contents.push({ role: 'model', parts })
      continue
    }

    if (role === 'tool') {
      const callId = msg.tool_call_id as string
      const fnName = toolCallNames.get(callId) ?? 'unknown'
      let responseObj: Record<string, unknown>
      try {
        responseObj = JSON.parse(String(msg.content ?? '{}')) as Record<string, unknown>
      } catch {
        responseObj = { result: String(msg.content ?? '') }
      }

      // Merge into last user content if it has function responses
      const lastContent = contents[contents.length - 1]
      if (lastContent?.role === 'user' && lastContent.parts.some((p) => p.functionResponse)) {
        lastContent.parts.push({ functionResponse: { name: fnName, response: responseObj } })
      } else {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: fnName, response: responseObj } }],
        })
      }
      continue
    }

    // 'user' role
    contents.push({ role: 'user', parts: toGeminiUserParts(msg.content) })
  }

  const result: GeminiRequest = {
    contents: mergeConsecutiveGeminiContents(contents),
  }

  if (systemParts) result.systemInstruction = { parts: systemParts }

  result.generationConfig = {}
  if (request.temperature != null) result.generationConfig.temperature = request.temperature
  if (request.maxTokens) result.generationConfig.maxOutputTokens = request.maxTokens

  if (request.tools?.length) {
    result.tools = [{
      functionDeclarations: request.tools.map((t) => {
        const fn = (t as Record<string, unknown>).function as Record<string, unknown>
        return {
          name: fn.name as string,
          description: (fn.description as string) ?? '',
          parameters: (fn.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
        }
      }),
    }]
  }

  return result
}

export function geminiToOpenai(response: GeminiResponse): ChatCompletionResponse {
  const candidate = response.candidates?.[0]
  if (!candidate) {
    return { choices: [{ message: { content: 'No response from Gemini' } }] }
  }

  let textContent = ''
  const toolCalls: ChatCompletionToolCall[] = []
  let callIndex = 0

  for (const part of candidate.content.parts) {
    if (part.text) {
      textContent += part.text
    } else if (part.functionCall) {
      toolCalls.push({
        id: `call_${callIndex++}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      })
    }
  }

  return {
    choices: [{
      message: {
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    }],
    usage: {
      prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: response.usageMetadata?.totalTokenCount ?? 0,
    },
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip 'anthropic/', 'openai/', etc. from model name for native API calls */
export function stripProviderPrefix(model: string): string {
  const slash = model.indexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}

type OpenAIContentPart = {
  type?: string
  text?: string
  image_url?: {
    url?: string
  }
}

function extractOpenAITextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part !== 'object' || part === null) return ''
      const typedPart = part as OpenAIContentPart
      if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
        return typedPart.text
      }
      if (typedPart.type === 'image_url') {
        return '[Image attachment]'
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toAnthropicUserContent(content: unknown): string | AnthropicContentBlock[] {
  if (!Array.isArray(content)) return String(content ?? '')

  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) blocks.push({ type: 'text', text: part })
      continue
    }
    if (typeof part !== 'object' || part === null) continue

    const typedPart = part as OpenAIContentPart
    if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
      blocks.push({ type: 'text', text: typedPart.text })
      continue
    }

    if (typedPart.type === 'image_url') {
      const url = typedPart.image_url?.url
      if (!url) continue

      const decoded = decodeDataUrl(url)
      if (!decoded?.isBase64) {
        blocks.push({ type: 'text', text: '[Image attachment omitted: unsupported URL source]' })
        continue
      }

      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: decoded.mimeType ?? 'image/png',
          data: decoded.data,
        },
      })
    }
  }

  if (blocks.length === 0) return ''
  if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text ?? ''
  return blocks
}

function toGeminiUserParts(content: unknown): GeminiPart[] {
  if (!Array.isArray(content)) {
    return [{ text: String(content ?? '') }]
  }

  const parts: GeminiPart[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) parts.push({ text: part })
      continue
    }
    if (typeof part !== 'object' || part === null) continue

    const typedPart = part as OpenAIContentPart
    if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
      parts.push({ text: typedPart.text })
      continue
    }

    if (typedPart.type === 'image_url') {
      const url = typedPart.image_url?.url
      if (!url) continue

      const decoded = decodeDataUrl(url)
      if (!decoded?.isBase64) {
        parts.push({ text: '[Image attachment omitted: unsupported URL source]' })
        continue
      }

      parts.push({
        inlineData: {
          mimeType: decoded.mimeType ?? 'image/png',
          data: decoded.data,
        },
      })
    }
  }

  return parts.length > 0 ? parts : [{ text: '' }]
}

function mergeConsecutiveMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = []
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // Merge content
      const lastBlocks = typeof last.content === 'string'
        ? [{ type: 'text' as const, text: last.content }]
        : last.content
      const newBlocks = typeof msg.content === 'string'
        ? [{ type: 'text' as const, text: msg.content }]
        : msg.content
      last.content = [...lastBlocks, ...newBlocks]
    } else {
      result.push({ ...msg })
    }
  }
  return result
}

function mergeConsecutiveGeminiContents(contents: GeminiContent[]): GeminiContent[] {
  const result: GeminiContent[] = []
  for (const c of contents) {
    const last = result[result.length - 1]
    if (last && last.role === c.role) {
      last.parts = [...last.parts, ...c.parts]
    } else {
      result.push({ ...c, parts: [...c.parts] })
    }
  }
  return result
}
