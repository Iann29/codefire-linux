import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Camera,
  CirclePlus,
  Square,
  Circle,
  Clock,
  X,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { api } from '@renderer/lib/api'

interface ReviewModeBarProps {
  projectId: string
  pageUrl: string
  onScreenshot: () => Promise<string | null>
  onClose: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function ReviewModeBar({
  projectId,
  pageUrl,
  onScreenshot,
  onClose,
}: ReviewModeBarProps) {
  const [elapsed, setElapsed] = useState(0)
  const [screenshotCount, setScreenshotCount] = useState(0)
  const [issueCount, setIssueCount] = useState(0)
  const [capturingScreenshot, setCapturingScreenshot] = useState(false)
  const [creatingIssue, setCreatingIssue] = useState(false)
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issueDescription, setIssueDescription] = useState('')
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)

  const startTimeRef = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const screenshotPathsRef = useRef<string[]>([])

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Clear last action feedback after 2s
  useEffect(() => {
    if (!lastAction) return
    const t = setTimeout(() => setLastAction(null), 2000)
    return () => clearTimeout(t)
  }, [lastAction])

  const handleScreenshot = useCallback(async () => {
    setCapturingScreenshot(true)
    try {
      const dataUrl = await onScreenshot()
      if (dataUrl) {
        screenshotPathsRef.current.push(dataUrl)
        setScreenshotCount((c) => c + 1)
        setLastAction('Screenshot captured')
      }
    } catch (err) {
      console.error('Failed to capture screenshot:', err)
    } finally {
      setCapturingScreenshot(false)
    }
  }, [onScreenshot])

  const handleCreateIssue = useCallback(async () => {
    if (!issueTitle.trim()) return
    setCreatingIssue(true)
    try {
      let desc = issueDescription
      desc += `\n\n**Review URL:** ${pageUrl}`
      desc += `\n**Review Duration:** ${formatDuration(elapsed)}`

      await api.tasks.create({
        projectId,
        title: issueTitle.trim(),
        description: desc.trim(),
        priority: 3,
        source: 'review',
        labels: ['client-review'],
      })

      setIssueCount((c) => c + 1)
      setIssueTitle('')
      setIssueDescription('')
      setShowIssueForm(false)
      setLastAction('Issue created')
    } catch (err) {
      console.error('Failed to create issue:', err)
    } finally {
      setCreatingIssue(false)
    }
  }, [issueTitle, issueDescription, pageUrl, elapsed, projectId])

  const handleEndReview = useCallback(async () => {
    setEnding(true)
    try {
      const duration = formatDuration(elapsed)
      const summaryContent = [
        `# Client Review Summary`,
        ``,
        `**URL:** ${pageUrl}`,
        `**Duration:** ${duration}`,
        `**Screenshots:** ${screenshotCount}`,
        `**Issues Created:** ${issueCount}`,
        `**Date:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        ``,
        `---`,
        ``,
        `## Notes`,
        ``,
        `[Add review notes here]`,
      ].join('\n')

      await api.notes.create({
        projectId,
        title: `Review: ${pageUrl} (${duration})`,
        content: summaryContent,
      })

      onClose()
    } catch (err) {
      console.error('Failed to save review summary:', err)
      onClose()
    }
  }, [elapsed, pageUrl, screenshotCount, issueCount, projectId, onClose])

  return (
    <div className="relative">
      {/* Main bar */}
      <div className="flex items-center gap-3 bg-neutral-900 border-b border-amber-500/30 px-4 py-2">
        {/* Recording indicator */}
        <div className="flex items-center gap-1.5">
          <Circle size={8} className="text-red-500 fill-red-500 animate-pulse" />
          <span className="text-[11px] font-medium text-red-400 uppercase tracking-wider">Review</span>
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-neutral-700" />

        {/* Timer */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-300 font-mono">
          <Clock size={12} className="text-neutral-500" />
          {formatDuration(elapsed)}
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-neutral-700" />

        {/* Stats */}
        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
          <span>{screenshotCount} screenshot{screenshotCount !== 1 ? 's' : ''}</span>
          <span>{issueCount} issue{issueCount !== 1 ? 's' : ''}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Last action feedback */}
        {lastAction && (
          <div className="flex items-center gap-1 text-[11px] text-green-400 animate-fade-in">
            <Check size={12} />
            {lastAction}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {/* Screenshot */}
          <button
            onClick={handleScreenshot}
            disabled={capturingScreenshot}
            title="Capture screenshot"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 rounded transition-colors disabled:opacity-40"
          >
            {capturingScreenshot ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Camera size={13} />
            )}
            Screenshot
          </button>

          {/* Create Issue */}
          <button
            onClick={() => setShowIssueForm(!showIssueForm)}
            title="Create issue"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded transition-colors ${
              showIssueForm
                ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100'
            }`}
          >
            <CirclePlus size={13} />
            Create Issue
          </button>

          {/* Separator */}
          <div className="w-px h-5 bg-neutral-700 mx-1" />

          {/* End Review */}
          <button
            onClick={handleEndReview}
            disabled={ending}
            title="End review session"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 rounded transition-colors disabled:opacity-40"
          >
            {ending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Square size={11} className="fill-current" />
            )}
            End Review
          </button>

          {/* Close (no summary) */}
          <button
            onClick={onClose}
            title="Close without saving"
            className="p-1 text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Issue form dropdown */}
      {showIssueForm && (
        <div className="absolute top-full right-4 mt-1 w-[380px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50">
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="text-xs font-medium text-neutral-200">Create Review Issue</span>
            </div>

            {/* URL context */}
            <div className="text-[10px] text-neutral-500 font-mono truncate bg-neutral-800 rounded px-2 py-1">
              {pageUrl}
            </div>

            {/* Title */}
            <div className="space-y-1">
              <label className="text-[11px] text-neutral-500 uppercase tracking-wider">Title</label>
              <input
                type="text"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder="Describe the issue..."
                autoFocus
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-amber-500/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleCreateIssue()
                  }
                }}
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-[11px] text-neutral-500 uppercase tracking-wider">Description (optional)</label>
              <textarea
                value={issueDescription}
                onChange={(e) => setIssueDescription(e.target.value)}
                rows={2}
                placeholder="Additional details..."
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-amber-500/50 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowIssueForm(false)}
                className="px-2.5 py-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateIssue}
                disabled={!issueTitle.trim() || creatingIssue}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded transition-colors disabled:opacity-40"
              >
                {creatingIssue ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CirclePlus size={12} />
                )}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
