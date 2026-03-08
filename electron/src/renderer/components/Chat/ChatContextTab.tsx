import { AlertTriangle } from 'lucide-react'
import type { ChatMessage } from '@shared/models'
import { getContextWindowSize, estimateTokens } from './chatCommands'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

interface CompactionInfo {
  trimmedCount: number
  before: number
  after: number
}

interface ChatContextTabProps {
  messages: ChatMessage[]
  messageUsage: Record<number, TokenUsage>
  compactionInfo: CompactionInfo | null
  chatModel: string
  aiProvider: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChatContextTab({
  messages,
  messageUsage,
  compactionInfo,
  chatModel,
  aiProvider,
}: ChatContextTabProps) {
  // Compute stats
  const contextLimit = getContextWindowSize(chatModel) ?? 128000
  const userMessages = messages.filter(m => m.role === 'user')
  const assistantMessages = messages.filter(m => m.role === 'assistant')

  // Token totals from usage data
  let totalInput = 0
  let totalOutput = 0
  for (const usage of Object.values(messageUsage)) {
    totalInput += usage.prompt_tokens ?? 0
    totalOutput += usage.completion_tokens ?? 0
  }

  // Estimate if no usage data available
  const estimatedTotalTokens = totalInput + totalOutput > 0
    ? totalInput + totalOutput
    : messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  const usagePercent = Math.min(100, (estimatedTotalTokens / contextLimit) * 100)

  // Estimate cost (simplified — output is more expensive)
  const costPer1MOutput = chatModel.includes('opus') ? 75 : chatModel.includes('sonnet') ? 15 : 4
  const costPer1MInput = costPer1MOutput / 5
  const estimatedCost = (totalOutput / 1_000_000) * costPer1MOutput + (totalInput / 1_000_000) * costPer1MInput

  // Count attachments across all messages
  const totalAttachments = messages.reduce((sum, m) => sum + (m.attachments?.length ?? 0), 0)

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-4 text-xs">
      {/* Session Summary */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Session</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div className="flex justify-between">
            <span className="text-neutral-500">Provider</span>
            <span className="text-neutral-300">{aiProvider || 'unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Model</span>
            <span className="text-neutral-300 truncate ml-2">{chatModel.split('/').pop()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Context Limit</span>
            <span className="text-neutral-300">{(contextLimit / 1000).toFixed(0)}k</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Messages</span>
            <span className="text-neutral-300">{messages.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">User / Asst</span>
            <span className="text-neutral-300">{userMessages.length} / {assistantMessages.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Est. Cost</span>
            <span className="text-neutral-300">${estimatedCost.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* Context Usage Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Context Usage</h3>
          <span className={`text-[10px] font-mono ${usagePercent > 80 ? 'text-red-400' : usagePercent > 50 ? 'text-yellow-400' : 'text-green-400'}`}>
            {usagePercent.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${usagePercent > 80 ? 'bg-red-500' : usagePercent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
            style={{ width: `${Math.min(100, usagePercent)}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-neutral-600">
          <span>{estimatedTotalTokens.toLocaleString()} tokens used</span>
          <span>{contextLimit.toLocaleString()} limit</span>
        </div>
      </div>

      {/* Token Breakdown */}
      {(totalInput > 0 || totalOutput > 0) && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Token Breakdown</h3>
          <div className="space-y-1">
            {[
              { label: 'Input', value: totalInput, color: 'bg-blue-500' },
              { label: 'Output', value: totalOutput, color: 'bg-purple-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-neutral-500 w-12">{label}</span>
                <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${Math.min(100, (value / Math.max(totalInput, totalOutput, 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-neutral-400 w-16 text-right font-mono">{value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compaction Diagnostics */}
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

      {/* Diagnostics */}
      {totalAttachments > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Diagnostics</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="flex justify-between">
              <span className="text-neutral-500">Attachments</span>
              <span className="text-neutral-300">{totalAttachments}</span>
            </div>
          </div>
        </div>
      )}

      {/* Raw Messages */}
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Messages ({messages.length})</h3>
        <div className="max-h-64 overflow-y-auto border border-neutral-800 rounded">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-neutral-900">
              <tr className="text-neutral-600 border-b border-neutral-800">
                <th className="text-left px-2 py-1 font-medium">Role</th>
                <th className="text-right px-2 py-1 font-medium">Chars</th>
                <th className="text-right px-2 py-1 font-medium">~Tokens</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((msg) => {
                const chars = msg.content.length
                const tokens = messageUsage[msg.id]?.total_tokens ?? estimateTokens(msg.content)
                const hasAttachments = msg.attachments && msg.attachments.length > 0
                return (
                  <tr key={msg.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="px-2 py-0.5">
                      <span className={`${msg.role === 'user' ? 'text-blue-400' : msg.role === 'assistant' ? 'text-green-400' : 'text-neutral-500'}`}>
                        {msg.role}
                      </span>
                      {hasAttachments && <span className="text-yellow-500 ml-1" title="Has attachments">+{msg.attachments!.length}</span>}
                    </td>
                    <td className="px-2 py-0.5 text-right text-neutral-500 font-mono">{chars.toLocaleString()}</td>
                    <td className="px-2 py-0.5 text-right text-neutral-400 font-mono">{tokens.toLocaleString()}</td>
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
