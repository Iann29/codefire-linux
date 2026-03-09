import type {
  ChatEffortLevel,
  ChatMessage,
  RunUsageSnapshot,
  TokenUsage,
  UsageSource,
} from './models'

const EMPTY_USAGE: Required<Pick<TokenUsage, 'prompt_tokens' | 'completion_tokens' | 'total_tokens' | 'cache_read_tokens' | 'cache_write_tokens' | 'reasoning_tokens'>> = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
}

function coerceUsageValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function normalizeTokenUsage(usage?: TokenUsage | null): Required<typeof EMPTY_USAGE> {
  const promptTokens = coerceUsageValue(usage?.prompt_tokens)
  const completionTokens = coerceUsageValue(usage?.completion_tokens)
  const totalTokens = coerceUsageValue(usage?.total_tokens)

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens || promptTokens + completionTokens,
    cache_read_tokens: coerceUsageValue(usage?.cache_read_tokens),
    cache_write_tokens: coerceUsageValue(usage?.cache_write_tokens),
    reasoning_tokens: coerceUsageValue(usage?.reasoning_tokens),
  }
}

export function hasTokenUsage(usage?: TokenUsage | null): boolean {
  const normalized = normalizeTokenUsage(usage)
  return Object.values(normalized).some((value) => value > 0)
}

export function addTokenUsage(left?: TokenUsage | null, right?: TokenUsage | null): TokenUsage {
  const a = normalizeTokenUsage(left)
  const b = normalizeTokenUsage(right)

  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
    reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
    source: left?.source ?? right?.source ?? 'provider',
  }
}

export function createTokenUsage(
  usage?: TokenUsage | null,
  meta: { source?: UsageSource } = {},
): TokenUsage | null {
  if (!hasTokenUsage(usage)) return null

  return {
    ...normalizeTokenUsage(usage),
    source: meta.source ?? usage?.source ?? 'provider',
  }
}

export function createRunUsageSnapshot(
  usage: TokenUsage | null | undefined,
  meta: {
    callCount: number
    provider?: string | null
    model?: string | null
    effortLevel?: ChatEffortLevel | null
    capturedAt?: string | null
    source?: UsageSource
  },
): RunUsageSnapshot | null {
  const total = createTokenUsage(usage, { source: meta.source })
  if (!total) return null

  return {
    callCount: Math.max(0, Math.round(meta.callCount)),
    lastCall: total,
    total,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
    effortLevel: meta.effortLevel ?? null,
    capturedAt: meta.capturedAt ?? null,
    source: meta.source ?? total.source ?? 'provider',
  }
}

export function appendRunUsage(
  previous: RunUsageSnapshot | null,
  usage?: TokenUsage | null,
  meta: {
    provider?: string | null
    model?: string | null
    effortLevel?: ChatEffortLevel | null
    capturedAt?: string | null
    source?: UsageSource
  } = {},
): RunUsageSnapshot | null {
  const normalized = createTokenUsage(usage, { source: meta.source })
  if (!normalized) return previous

  const nextTotal = previous?.total ? addTokenUsage(previous.total, normalized) : normalized

  return {
    callCount: (previous?.callCount ?? 0) + 1,
    lastCall: normalized,
    total: nextTotal,
    provider: meta.provider ?? previous?.provider ?? null,
    model: meta.model ?? previous?.model ?? null,
    effortLevel: meta.effortLevel ?? previous?.effortLevel ?? null,
    capturedAt: meta.capturedAt ?? previous?.capturedAt ?? null,
    source: meta.source ?? previous?.source ?? normalized.source ?? 'provider',
  }
}

export function getConversationUsageContribution(message: ChatMessage): TokenUsage | null {
  return message.runUsage?.total ?? message.responseUsage ?? null
}

export function getConversationUsage(messages: ChatMessage[]): TokenUsage | null {
  const usageTotals = messages.reduce<TokenUsage | null>((acc, message) => {
    const next = getConversationUsageContribution(message)
    if (!next) return acc
    return acc ? addTokenUsage(acc, next) : next
  }, null)

  return createTokenUsage(usageTotals)
}

export function getLatestResponseUsage(messages: ChatMessage[]): TokenUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].responseUsage) return messages[index].responseUsage ?? null
  }
  return null
}

export function getLatestRunUsage(messages: ChatMessage[]): RunUsageSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].runUsage) return messages[index].runUsage ?? null
  }
  return null
}
