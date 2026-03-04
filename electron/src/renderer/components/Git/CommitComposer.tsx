import { useState, useCallback, type KeyboardEvent } from 'react'

interface CommitComposerProps {
  stagedCount: number
  onStageAll: () => void
  onUnstageAll: () => void
  onCommit: (message: string) => Promise<unknown>
}

export default function CommitComposer({
  stagedCount,
  onStageAll,
  onUnstageAll,
  onCommit,
}: CommitComposerProps) {
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)

  const canCommit = stagedCount > 0 && message.trim().length > 0 && !committing

  const handleCommit = useCallback(async () => {
    if (!canCommit) return
    try {
      setCommitting(true)
      await onCommit(message.trim())
      setMessage('')
    } catch (err) {
      console.error('Commit failed:', err)
    } finally {
      setCommitting(false)
    }
  }, [canCommit, message, onCommit])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleCommit()
      }
    },
    [handleCommit]
  )

  return (
    <div className="px-4 py-3 border-b border-neutral-800 space-y-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        rows={2}
        className="w-full bg-neutral-800/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm font-mono text-neutral-200 placeholder:text-neutral-600 resize-none focus:outline-none focus:border-codefire-orange/50 transition-colors"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onStageAll}
          className="text-[11px] px-2.5 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
        >
          Stage All
        </button>
        <button
          type="button"
          onClick={onUnstageAll}
          className="text-[11px] px-2.5 py-1 rounded bg-codefire-orange/10 text-codefire-orange hover:bg-codefire-orange/20 transition-colors"
        >
          Unstage All
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleCommit}
          disabled={!canCommit}
          className="text-[11px] px-3 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {committing ? 'Committing...' : 'Commit'}
        </button>
      </div>
    </div>
  )
}
