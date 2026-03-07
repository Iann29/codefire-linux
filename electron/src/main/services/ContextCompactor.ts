/**
 * Context compaction for long agent runs.
 * Ported from amage-ai-browser-agent/ai/compaction.ts
 *
 * When conversation approaches context limit, older messages are summarized
 * via LLM and replaced with a compact summary + preserved recent messages.
 */

import { estimateMessageTokens, estimateContextTokens } from './TokenEstimator'

const DEFAULT_CONTEXT_LIMIT = 128_000
const RESERVE_TOKENS = 16_384
const KEEP_RECENT_TOKENS = 20_000

interface CompactionResult {
  compacted: boolean
  messages: Array<Record<string, unknown>>
  trimmedCount: number
  preservedCount: number
  summary: string | null
  contextUsage: { before: number; after: number; limit: number }
}

interface CompactionConfig {
  contextLimit?: number
  reserveTokens?: number
  keepRecentTokens?: number
}

export class ContextCompactor {
  private existingSummary: string | null = null

  shouldCompact(
    messages: Array<Record<string, unknown>>,
    config?: CompactionConfig
  ): boolean {
    const limit = config?.contextLimit ?? DEFAULT_CONTEXT_LIMIT
    const reserve = config?.reserveTokens ?? RESERVE_TOKENS
    const tokens = estimateContextTokens(messages)
    return tokens > limit - reserve
  }

  /**
   * Find the cut point using suffix sums.
   * Never cuts in the middle of a tool result sequence.
   * Preserves keepRecentTokens worth of messages from the end.
   */
  findCutPoint(
    messages: Array<Record<string, unknown>>,
    config?: CompactionConfig
  ): number {
    const keepRecent = config?.keepRecentTokens ?? KEEP_RECENT_TOKENS

    // Build suffix sums
    const suffixTokens = new Array<number>(messages.length + 1).fill(0)
    for (let i = messages.length - 1; i >= 0; i--) {
      suffixTokens[i] = suffixTokens[i + 1] + estimateMessageTokens(messages[i])
    }

    // Binary search for cut point where suffix >= keepRecent
    let low = 1 // never cut the system message (index 0)
    let high = messages.length - 1
    let bestCut = 1

    while (low <= high) {
      const mid = (low + high) >> 1
      if (suffixTokens[mid] >= keepRecent) {
        bestCut = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    // Don't cut in the middle of a tool result sequence
    // Walk forward to find a valid cut point (not a tool role)
    while (bestCut < messages.length && messages[bestCut].role === 'tool') {
      bestCut++
    }

    // Must keep at least the system message + 1 message
    return Math.max(1, Math.min(bestCut, messages.length - 2))
  }

  /**
   * Serialize messages for summarization.
   */
  serializeForSummary(messages: Array<Record<string, unknown>>): string {
    const lines: string[] = []
    for (const msg of messages) {
      const role = msg.role as string
      let content = ''

      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<Record<string, unknown>>)
          .map((b) => (b.text as string) ?? (b.type as string) ?? '')
          .join(' ')
      }

      // Truncate long content for summary input
      if (content.length > 1000) {
        content = content.slice(0, 1000) + '...[truncated]'
      }

      if (role === 'tool') {
        const toolId = msg.tool_call_id as string
        lines.push(`[Tool Result ${toolId}]: ${content.slice(0, 500)}`)
      } else if (role === 'assistant' && msg.tool_calls) {
        const calls = msg.tool_calls as Array<{ function: { name: string } }>
        const names = calls.map((c) => c.function?.name).join(', ')
        lines.push(`[Assistant] ${content || ''}\n  Tool calls: ${names}`)
      } else {
        lines.push(`[${role}] ${content}`)
      }
    }
    return lines.join('\n')
  }

  buildSummarizationPrompt(serialized: string): string {
    const base = this.existingSummary
      ? `You are updating a conversation summary. Previous summary:\n\n${this.existingSummary}\n\nNew messages to incorporate:\n\n${serialized}`
      : `Summarize this conversation concisely:\n\n${serialized}`

    return `${base}

Format your summary EXACTLY as:
**Goal:** [What the user wants to achieve]
**Constraints:** [Any limitations or requirements]
**Progress:** [What has been done so far, key actions taken]
**Key Decisions:** [Important choices made during the conversation]
**Next Steps:** [What needs to happen next]
**Critical Context:** [Any information that must not be lost]

Be concise. Focus on actionable information. Skip pleasantries and filler.`
  }

  /**
   * Apply compaction to messages.
   * Replaces old messages with a summary, keeps recent ones.
   */
  applyCompaction(
    messages: Array<Record<string, unknown>>,
    summary: string,
    cutPoint: number
  ): CompactionResult {
    const before = estimateContextTokens(messages)
    this.existingSummary = summary

    const systemMessage = messages[0]
    const preservedMessages = messages.slice(cutPoint)
    const trimmedCount = cutPoint - 1 // minus system message

    const compactedMessages: Array<Record<string, unknown>> = [
      systemMessage,
      {
        role: 'user',
        content: `[CONTEXT COMPACTION] The following is a summary of our conversation so far:\n\n${summary}\n\nPlease continue from where we left off.`,
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our previous conversation. Continuing from where we left off.',
      },
      ...preservedMessages,
    ]

    const after = estimateContextTokens(compactedMessages)

    return {
      compacted: true,
      messages: compactedMessages,
      trimmedCount,
      preservedCount: preservedMessages.length,
      summary,
      contextUsage: {
        before,
        after,
        limit: DEFAULT_CONTEXT_LIMIT,
      },
    }
  }
}
