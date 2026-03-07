/**
 * Token estimation utilities.
 * Ported from amage-ai-browser-agent/ai/compaction.ts
 *
 * Uses length/4 heuristic — fast and good enough for compaction decisions.
 */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessageTokens(message: Record<string, unknown>): number {
  let tokens = 4 // message overhead

  const content = message.content
  if (typeof content === 'string') {
    tokens += estimateTokens(content)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') {
        tokens += estimateTokens(block)
      } else if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          tokens += estimateTokens(b.text)
        } else if (b.type === 'image' || b.type === 'image_url') {
          tokens += 1200 // image token estimate
        } else {
          tokens += estimateTokens(JSON.stringify(block))
        }
      }
    }
  }

  // Tool calls
  const toolCalls = message.tool_calls
  if (Array.isArray(toolCalls)) {
    tokens += estimateTokens(JSON.stringify(toolCalls))
  }

  return tokens
}

export function estimateContextTokens(messages: Array<Record<string, unknown>>): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}
