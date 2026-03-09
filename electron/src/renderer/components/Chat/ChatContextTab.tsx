import { AlertTriangle } from 'lucide-react'
import type { ChatEffortLevel, ChatMessage, RunUsageSnapshot, TokenUsage } from '@shared/models'
import { getContextWindowSize, estimateTokens } from './chatCommands'

interface CompactionInfo {
  trimmedCount: number
  before: number
  after: number
}

interface ChatContextTabProps {
  messages: ChatMessage[]
  compactionInfo: CompactionInfo | null
  chatModel: string
  aiProvider: string
  effortLevel: ChatEffortLevel
  runUsage: RunUsageSnapshot | null
}

type UsageConfidence = 'provider' | 'estimated' | 'session' | 'mixed' | 'none'

function usageLabel(confidence: UsageConfidence): string {
  if (confidence === 'provider') return 'Exact'
  if (confidence === 'estimated') return 'Estimated'
  if (confidence === 'session') return 'Session'
  if (confidence === 'mixed') return 'Mixed'
  return 'No data'
}

function usageBadgeClass(confidence: UsageConfidence): string {
  if (confidence === 'provider' || confidence === 'session') return 'border-green-800/60 bg-green-950/30 text-green-300'
  if (confidence === 'estimated') return 'border-yellow-800/60 bg-yellow-950/30 text-yellow-300'
  if (confidence === 'mixed') return 'border-blue-800/60 bg-blue-950/30 text-blue-300'
  return 'border-neutral-800 bg-neutral-900/50 text-neutral-500'
}

function normalizeUsage(usage: TokenUsage | null | undefined): TokenUsage | null {
  if (!usage) return null
  const prompt_tokens = usage.prompt_tokens ?? 0
  const completion_tokens = usage.completion_tokens ?? 0
  const total_tokens = usage.total_tokens ?? (prompt_tokens + completion_tokens)
  const cache_read_tokens = usage.cache_read_tokens ?? 0
  const cache_write_tokens = usage.cache_write_tokens ?? 0
  const reasoning_tokens = usage.reasoning_tokens ?? 0

  if (
    prompt_tokens === 0 &&
    completion_tokens === 0 &&
    total_tokens === 0 &&
    cache_read_tokens === 0 &&
    cache_write_tokens === 0 &&
    reasoning_tokens === 0
  ) {
    return null
  }

  return {
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cache_read_tokens,
    cache_write_tokens,
    reasoning_tokens,
    source: usage.source ?? 'provider',
  }
}

function sumUsages(usages: TokenUsage[]): TokenUsage | null {
  if (usages.length === 0) return null
  return usages.reduce<TokenUsage>((acc, usage) => ({
    prompt_tokens: (acc.prompt_tokens ?? 0) + (usage.prompt_tokens ?? 0),
    completion_tokens: (acc.completion_tokens ?? 0) + (usage.completion_tokens ?? 0),
    total_tokens: (acc.total_tokens ?? 0) + (usage.total_tokens ?? 0),
    cache_read_tokens: (acc.cache_read_tokens ?? 0) + (usage.cache_read_tokens ?? 0),
    cache_write_tokens: (acc.cache_write_tokens ?? 0) + (usage.cache_write_tokens ?? 0),
    reasoning_tokens: (acc.reasoning_tokens ?? 0) + (usage.reasoning_tokens ?? 0),
    source: acc.source ?? usage.source,
  }), {})
}

function getConfidence(usages: Array<TokenUsage | null | undefined>): UsageConfidence {
  const present = usages
    .map((usage) => normalizeUsage(usage))
    .filter((usage): usage is TokenUsage => Boolean(usage))

  if (present.length === 0) return 'none'

  const sources = new Set(
    present.map((usage) => usage.source ?? 'provider')
  )

  if (sources.size > 1) return 'mixed'
  const source = sources.values().next().value as UsageConfidence
  return source ?? 'none'
}

function formatUsage(usage: TokenUsage | null | undefined): string {
  const normalized = normalizeUsage(usage)
  if (!normalized) return 'No usage data yet'
  return `${(normalized.prompt_tokens ?? 0).toLocaleString()} in / ${(normalized.completion_tokens ?? 0).toLocaleString()} out`
}

function getUsageForMessage(message: ChatMessage): TokenUsage | null {
  return normalizeUsage(message.runUsage?.total ?? message.responseUsage)
}

function getResponseUsageForMessage(message: ChatMessage): TokenUsage | null {
  return normalizeUsage(message.responseUsage)
}

function getLatestAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i]
  }
  return null
}

function getEstimatedCost(chatModel: string, usage: TokenUsage | null): number {
  if (!usage) return 0
  const costPer1MOutput = chatModel.includes('opus') ? 75 : chatModel.includes('sonnet') ? 15 : 4
  const costPer1MInput = costPer1MOutput / 5
  return ((usage.completion_tokens ?? 0) / 1_000_000) * costPer1MOutput
    + ((usage.prompt_tokens ?? 0) / 1_000_000) * costPer1MInput
}

function UsageSection({
  title,
  usage,
  confidence,
  subtitle,
}: {
  title: string
  usage: TokenUsage | null
  confidence: UsageConfidence
  subtitle?: string
}) {
  return (
    <div className="space-y-1.5 rounded border border-neutral-800 bg-neutral-900/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">{title}</h3>
        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${usageBadgeClass(confidence)}`}>
          {usageLabel(confidence)}
        </span>
      </div>
      <p className="text-sm text-neutral-200 tabular-nums">{formatUsage(usage)}</p>
      {subtitle && (
        <p className="text-[10px] text-neutral-500">{subtitle}</p>
      )}
      {usage && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Input</span>
            <span className="text-neutral-300 font-mono">{(usage.prompt_tokens ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Output</span>
            <span className="text-neutral-300 font-mono">{(usage.completion_tokens ?? 0).toLocaleString()}</span>
          </div>
          {(usage.cache_read_tokens ?? 0) > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-neutral-500">Cache read</span>
              <span className="text-neutral-300 font-mono">{(usage.cache_read_tokens ?? 0).toLocaleString()}</span>
            </div>
          )}
          {(usage.cache_write_tokens ?? 0) > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-neutral-500">Cache write</span>
              <span className="text-neutral-300 font-mono">{(usage.cache_write_tokens ?? 0).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatContextTab({
  messages,
  compactionInfo,
  chatModel,
  aiProvider,
  effortLevel,
  runUsage,
}: ChatContextTabProps) {
  const contextLimit = getContextWindowSize(chatModel) ?? 128000
  const userMessages = messages.filter((message) => message.role === 'user')
  const assistantMessages = messages.filter((message) => message.role === 'assistant')
  const totalAttachments = messages.reduce((sum, message) => sum + (message.attachments?.length ?? 0), 0)
  const contextEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  const contextPercent = Math.min(100, (contextEstimate / contextLimit) * 100)
  const latestAssistantMessage = getLatestAssistantMessage(messages)
  const latestRunUsage = runUsage ?? latestAssistantMessage?.runUsage ?? null
  const lastCallUsage = normalizeUsage(latestRunUsage?.lastCall ?? latestAssistantMessage?.responseUsage)
  const currentRunUsage = normalizeUsage(latestRunUsage?.total ?? latestAssistantMessage?.responseUsage)
  const conversationUsageEntries = assistantMessages
    .map((message) => getUsageForMessage(message))
    .filter((usage): usage is TokenUsage => Boolean(usage))
  const conversationTotal = sumUsages(conversationUsageEntries)
  const conversationConfidence = getConfidence(assistantMessages.map((message) => message.runUsage?.total ?? message.responseUsage))
  const lastCallConfidence = getConfidence([lastCallUsage])
  const runConfidence = getConfidence([currentRunUsage])
  const effectiveProvider = latestRunUsage?.provider ?? latestAssistantMessage?.provider ?? aiProvider
  const effectiveModel = latestRunUsage?.model ?? latestAssistantMessage?.model ?? chatModel
  const effectiveEffort = latestRunUsage?.effortLevel ?? latestAssistantMessage?.effortLevel ?? effortLevel
  const estimatedCost = getEstimatedCost(chatModel, conversationTotal)

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-4 text-xs">
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Session</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Provider</span>
            <span className="text-neutral-300">{effectiveProvider || 'unknown'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Model</span>
            <span className="text-neutral-300 truncate ml-2">{effectiveModel.split('/').pop()}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Effort</span>
            <span className="text-neutral-300">{effectiveEffort || 'default'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Context Limit</span>
            <span className="text-neutral-300">{(contextLimit / 1000).toFixed(0)}k</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Messages</span>
            <span className="text-neutral-300">{messages.length}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">User / Asst</span>
            <span className="text-neutral-300">{userMessages.length} / {assistantMessages.length}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Attachments</span>
            <span className="text-neutral-300">{totalAttachments}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Est. Cost</span>
            <span className="text-neutral-300">${estimatedCost.toFixed(4)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Current Context Estimate</h3>
          <span className="rounded-full border border-yellow-800/60 bg-yellow-950/30 px-1.5 py-0.5 text-[9px] font-medium text-yellow-300">
            Estimated
          </span>
        </div>
        <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${contextPercent > 80 ? 'bg-red-500' : contextPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
            style={{ width: `${Math.min(100, contextPercent)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>{contextEstimate.toLocaleString()} tokens</span>
          <span>{contextPercent.toFixed(1)}% of window</span>
        </div>
      </div>

      <UsageSection
        title="Last Provider Call"
        usage={lastCallUsage}
        confidence={lastCallConfidence}
        subtitle={latestRunUsage?.capturedAt ? `Captured ${new Date(latestRunUsage.capturedAt).toLocaleTimeString()}` : undefined}
      />

      <UsageSection
        title="This Run"
        usage={currentRunUsage}
        confidence={runConfidence}
        subtitle={latestRunUsage ? `${latestRunUsage.callCount} provider call${latestRunUsage.callCount === 1 ? '' : 's'} in this run` : 'No completed run for this conversation yet'}
      />

      <UsageSection
        title="This Conversation"
        usage={conversationTotal}
        confidence={conversationConfidence}
        subtitle="Aggregates assistant runs for the active conversation only"
      />

      {compactionInfo && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle size={10} />
            Compaction
          </h3>
          <div className="bg-yellow-950/30 border border-yellow-800/30 rounded px-2 py-1.5 text-[10px] text-yellow-400/80">
            <p>{compactionInfo.trimmedCount} messages compacted</p>
            <p>Before: {compactionInfo.before} tokens &rarr; After: {compactionInfo.after} tokens</p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Messages ({messages.length})</h3>
        <div className="max-h-64 overflow-y-auto border border-neutral-800 rounded">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-neutral-900">
              <tr className="text-neutral-600 border-b border-neutral-800">
                <th className="text-left px-2 py-1 font-medium">Role</th>
                <th className="text-right px-2 py-1 font-medium">Chars</th>
                <th className="text-right px-2 py-1 font-medium">Tokens</th>
                <th className="text-right px-2 py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => {
                const chars = message.content.length
                const responseUsage = getResponseUsageForMessage(message)
                const runTotalUsage = getUsageForMessage(message)
                const tokenUsage = runTotalUsage ?? responseUsage
                const tokens = tokenUsage?.total_tokens ?? estimateTokens(message.content)
                const source = tokenUsage?.source ?? 'estimated'
                const hasAttachments = message.attachments && message.attachments.length > 0

                return (
                  <tr key={message.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="px-2 py-0.5">
                      <span className={`${message.role === 'user' ? 'text-blue-400' : message.role === 'assistant' ? 'text-green-400' : 'text-neutral-500'}`}>
                        {message.role}
                      </span>
                      {hasAttachments && <span className="text-yellow-500 ml-1" title="Has attachments">+{message.attachments!.length}</span>}
                    </td>
                    <td className="px-2 py-0.5 text-right text-neutral-500 font-mono">{chars.toLocaleString()}</td>
                    <td className="px-2 py-0.5 text-right text-neutral-400 font-mono">{tokens.toLocaleString()}</td>
                    <td className="px-2 py-0.5 text-right text-neutral-500">
                      {source === 'provider' ? 'exact' : source === 'session' ? 'session' : 'est'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
