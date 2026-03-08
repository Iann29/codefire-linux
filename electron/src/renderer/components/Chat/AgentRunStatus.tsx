import { useState, useEffect } from 'react'
import { Loader2, Wrench, AlertTriangle, XCircle, Zap } from 'lucide-react'

type RuntimePhase = 'thinking' | 'streaming' | 'running_tool' | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'errored'

interface ToolExecution {
  name: string
  status: 'running' | 'done' | 'error'
  result?: string
}

interface AgentRunStatusProps {
  sending: boolean
  streaming: boolean
  toolExecutions: ToolExecution[]
  confirmAction: { tool: string; args: Record<string, unknown> } | null
  startedAt: number | null
  error?: string | null
}

function derivePhase(props: AgentRunStatusProps): RuntimePhase {
  if (props.error) return 'errored'
  if (props.confirmAction) return 'awaiting_confirmation'
  if (props.toolExecutions.some(t => t.status === 'running')) return 'running_tool'
  if (props.streaming) return 'streaming'
  if (props.sending) return 'thinking'
  return 'completed'
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return (
    <span className="text-[10px] text-neutral-500 font-mono tabular-nums">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  )
}

export default function AgentRunStatus({ sending, streaming, toolExecutions, confirmAction, startedAt, error }: AgentRunStatusProps) {
  const phase = derivePhase({ sending, streaming, toolExecutions, confirmAction, startedAt, error })

  if (phase === 'completed') return null

  const runningTool = toolExecutions.find(t => t.status === 'running')
  const completedCount = toolExecutions.filter(t => t.status === 'done').length
  const totalCount = toolExecutions.length

  return (
    <div className="flex items-center gap-2 px-3 py-2 mx-2 mb-2 rounded-lg bg-neutral-800/50 border border-neutral-700/50">
      {/* Phase icon */}
      {phase === 'thinking' && (
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-5 h-5">
            <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
            <Zap size={12} className="text-blue-400 relative z-10" />
          </div>
          <span className="text-xs text-neutral-300">Thinking</span>
          <ThinkingDots />
        </div>
      )}

      {phase === 'streaming' && (
        <div className="flex items-center gap-2">
          <Loader2 size={12} className="text-codefire-orange animate-spin" />
          <span className="text-xs text-neutral-300">Responding</span>
        </div>
      )}

      {phase === 'running_tool' && runningTool && (
        <div className="flex items-center gap-2">
          <Wrench size={12} className="text-violet-400 animate-pulse" />
          <span className="text-xs text-neutral-300 truncate max-w-[140px]">{runningTool.name}</span>
          {totalCount > 1 && (
            <span className="text-[10px] text-neutral-500">{completedCount}/{totalCount}</span>
          )}
        </div>
      )}

      {phase === 'awaiting_confirmation' && (
        <div className="flex items-center gap-2">
          <AlertTriangle size={12} className="text-amber-400" />
          <span className="text-xs text-amber-300">Awaiting confirmation</span>
        </div>
      )}

      {phase === 'errored' && (
        <div className="flex items-center gap-2">
          <XCircle size={12} className="text-red-400" />
          <span className="text-xs text-red-300 truncate max-w-[200px]">{error || 'Error'}</span>
        </div>
      )}

      {/* Elapsed time */}
      <div className="ml-auto">
        {startedAt && <ElapsedTimer startedAt={startedAt} />}
      </div>
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  )
}
