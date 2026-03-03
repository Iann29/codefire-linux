// ─── Session Parser ─────────────────────────────────────────────────────────
//
// Pure function that parses Claude Code JSONL session files into structured data.
// Each line in the JSONL is a JSON object with a `type` field.
// We only care about `user` and `assistant` types for session metadata.
//

export interface ParsedSession {
  sessionId: string
  slug: string | null
  model: string | null
  gitBranch: string | null
  startedAt: string | null
  endedAt: string | null
  messageCount: number
  toolUseCount: number
  filesChanged: string[]
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

interface JsonlLine {
  type?: string
  sessionId?: string
  slug?: string
  gitBranch?: string
  timestamp?: string
  message?: {
    role?: string
    model?: string
    content?: string | ContentBlock[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

interface ContentBlock {
  type: string
  input?: {
    file_path?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Parse a Claude Code JSONL session file into structured session data.
 *
 * This is a pure function with no file I/O — it takes raw file content
 * and returns a ParsedSession.
 *
 * @param content - Raw UTF-8 content of the .jsonl file
 * @param sessionId - The session UUID (extracted from the filename)
 */
export function parseSessionFile(content: string, sessionId: string): ParsedSession {
  const result: ParsedSession = {
    sessionId,
    slug: null,
    model: null,
    gitBranch: null,
    startedAt: null,
    endedAt: null,
    messageCount: 0,
    toolUseCount: 0,
    filesChanged: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  }

  const filePathsSet = new Set<string>()
  const lines = content.split('\n').filter((line) => line.trim().length > 0)

  for (const line of lines) {
    let parsed: JsonlLine
    try {
      parsed = JSON.parse(line) as JsonlLine
    } catch {
      // Skip malformed lines
      continue
    }

    // Extract metadata from any line (sessionId, slug, gitBranch can appear on any type)
    if (parsed.slug && !result.slug) {
      result.slug = parsed.slug
    }
    if (parsed.gitBranch && !result.gitBranch) {
      result.gitBranch = parsed.gitBranch
    }

    // Track timestamps from any line that has one
    if (parsed.timestamp) {
      const ts = parsed.timestamp
      if (!result.startedAt || ts < result.startedAt) {
        result.startedAt = ts
      }
      if (!result.endedAt || ts > result.endedAt) {
        result.endedAt = ts
      }
    }

    // Only process user and assistant message types
    const type = parsed.type
    if (type !== 'user' && type !== 'assistant') {
      continue
    }

    // Count user and assistant messages
    result.messageCount++

    if (type === 'assistant' && parsed.message) {
      const msg = parsed.message

      // Extract model
      if (msg.model && !result.model) {
        result.model = msg.model
      }

      // Sum token usage
      if (msg.usage) {
        result.inputTokens += msg.usage.input_tokens ?? 0
        result.outputTokens += msg.usage.output_tokens ?? 0
        result.cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0
        result.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0
      }

      // Process content blocks for tool_use
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            result.toolUseCount++

            // Extract file_path from tool inputs
            if (block.input?.file_path && typeof block.input.file_path === 'string') {
              filePathsSet.add(block.input.file_path)
            }
          }
        }
      }
    }
  }

  result.filesChanged = Array.from(filePathsSet)
  return result
}
