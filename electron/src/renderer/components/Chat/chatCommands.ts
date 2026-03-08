export interface CommandResult {
  kind: 'local'
  command: string
  content: string
}

export interface CommandError {
  kind: 'error'
  command: string
  message: string
}

export interface CommandPassthrough {
  kind: 'passthrough'
}

export type ParseResult = CommandResult | CommandError | CommandPassthrough

// Model context window sizes (approximate)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Claude
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 128_000,
  'gpt-5.4': 128_000,
  'o1': 200_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  // Gemini
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-3.1-pro': 1_000_000,
  'gemini-3-flash': 1_000_000,
  // DeepSeek
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 128_000,
  'deepseek-v3.2': 128_000,
  // Qwen
  'qwen3-235b-a22b': 128_000,
  'qwen3.5-plus': 128_000,
  'qwen3-coder': 128_000,
  // Aliases
  'best': 200_000,
  'fast': 128_000,
  'cheap': 128_000,
  'smart': 200_000,
  'code': 200_000,
}

export function getContextWindowSize(model: string): number | null {
  // Try exact match
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model]
  // Try partial match (model name contains key)
  for (const [key, val] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.includes(key) || key.includes(model)) return val
  }
  return null
}

interface ContextInfo {
  model: string
  provider: string
  messageCount: number
  estimatedTokens: number
  contextWindow: number | null
  percentUsed: number | null
  hasCompaction: boolean
  compactionCount?: number
}

export function formatContextCommand(info: ContextInfo): string {
  const lines: string[] = []
  lines.push(`**Model:** ${info.model}`)
  lines.push(`**Provider:** ${info.provider}`)
  lines.push(`**Messages in context:** ${info.messageCount}`)
  lines.push(`**Estimated tokens:** ~${info.estimatedTokens.toLocaleString()}`)

  if (info.contextWindow) {
    lines.push(`**Context window:** ${info.contextWindow.toLocaleString()} tokens`)
    if (info.percentUsed !== null) {
      const bar = renderBar(info.percentUsed)
      lines.push(`**Usage:** ${bar} ${info.percentUsed.toFixed(1)}%`)
    }
  } else {
    lines.push(`**Context window:** unknown`)
  }

  if (info.hasCompaction) {
    lines.push(`**Compaction:** active (${info.compactionCount ?? 0} compressions)`)
  }

  return lines.join('\n')
}

function renderBar(percent: number): string {
  const total = 20
  const filled = Math.round((percent / 100) * total)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(total - filled)
}

export function parseSlashCommand(input: string): ParseResult {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return { kind: 'passthrough' }

  const parts = trimmed.split(/\s+/)
  const cmd = parts[0].toLowerCase()

  switch (cmd) {
    case '/context':
      // Handled by the caller — returns a signal
      return { kind: 'local', command: 'context', content: '' }
    default:
      return { kind: 'error', command: cmd, message: `Unknown command: ${cmd}. Available: /context` }
  }
}

// Rough token estimator (4 chars ~ 1 token)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
