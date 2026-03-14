import { useState } from 'react'
import { Folder, Code, FolderOpen, Bell } from 'lucide-react'
import type { IndexProgress } from '@shared/models'

interface ProjectHeaderBarProps {
  projectName: string
  projectPath: string
  indexStatus: 'idle' | 'indexing' | 'ready' | 'error'
  indexTotalChunks?: number
  indexProgress?: IndexProgress | null
  indexLastError?: string
  onRequestIndex?: () => void
  onBriefingClick?: () => void
  briefingCount?: number
}

function truncatePath(p: string, maxLen = 50): string {
  if (p.length <= maxLen) return p
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.length <= 2) return p
  return '.../' + segments.slice(-2).join('/')
}

/**
 * Renders left (project name) and right (indicators) sections.
 * Parent must provide flex layout with a spacer between them.
 */
export function ProjectHeaderLeft({ projectName, projectPath }: { projectName: string; projectPath: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-neutral-800/50" title={projectPath}>
      <Folder className="w-3 h-3 text-codefire-orange" />
      <span className="text-[11px] font-medium text-neutral-300 max-w-32 truncate">{projectName}</span>
    </div>
  )
}

export function ProjectHeaderRight({
  indexStatus,
  indexTotalChunks,
  indexProgress,
  indexLastError,
  onRequestIndex,
  onBriefingClick,
  briefingCount,
}: Omit<ProjectHeaderBarProps, 'projectName' | 'projectPath'>) {
  return (
    <div className="flex items-center gap-1.5">
      <HeaderIndexIndicator
        status={indexStatus}
        totalChunks={indexTotalChunks}
        progress={indexProgress}
        lastError={indexLastError}
        onRequestIndex={onRequestIndex}
      />
      <HeaderFilesystemIndicator />

      {/* Briefing bell button */}
      {onBriefingClick && (
        <>
          <div className="w-px h-4 bg-neutral-700 mx-0.5" />
          <button
            onClick={onBriefingClick}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors relative"
            title="Briefing"
          >
            <Bell className="w-3.5 h-3.5" />
            {(briefingCount ?? 0) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-codefire-orange text-white text-[7px] font-bold flex items-center justify-center">
                {briefingCount! > 9 ? '9+' : briefingCount}
              </span>
            )}
          </button>
        </>
      )}
    </div>
  )
}

/** Legacy default export — still works but prefer the split components */
export default function ProjectHeaderBar(props: ProjectHeaderBarProps) {
  return (
    <>
      <ProjectHeaderLeft projectName={props.projectName} projectPath={props.projectPath} />
      <div className="flex-1" />
      <ProjectHeaderRight {...props} />
    </>
  )
}

// --- Index Indicator (header pill style) ---

function HeaderIndexIndicator({
  status,
  totalChunks,
  progress,
  lastError,
  onRequestIndex,
}: {
  status: 'idle' | 'indexing' | 'ready' | 'error'
  totalChunks?: number
  progress?: IndexProgress | null
  lastError?: string
  onRequestIndex?: () => void
}) {
  const [showError, setShowError] = useState(false)

  const colors = {
    idle: { text: 'text-neutral-500', bg: 'bg-neutral-500/10', border: 'border-transparent' },
    indexing: { text: 'text-codefire-orange', bg: 'bg-codefire-orange/10', border: 'border-codefire-orange/30' },
    ready: { text: 'text-success', bg: 'bg-success/10', border: 'border-success/30' },
    error: { text: 'text-error', bg: 'bg-error/10', border: 'border-error/30' },
  }
  const c = colors[status]
  const isClickable = (status === 'idle' && !!onRequestIndex) || status === 'error'

  const handleClick = () => {
    if (status === 'idle' && onRequestIndex) {
      onRequestIndex()
    } else if (status === 'error') {
      setShowError((prev) => !prev)
    }
  }

  const label = (() => {
    switch (status) {
      case 'idle': return 'Not Indexed'
      case 'indexing': return getProgressHeadline(progress)
      case 'ready': return totalChunks !== undefined ? `Indexed ${totalChunks}` : 'Indexed'
      case 'error': return 'Index Error'
    }
  })()

  const progressCaption = status === 'indexing' ? getProgressCaption(progress) : null
  const progressPercent = status === 'indexing' ? getProgressPercent(progress) : undefined

  const title = status === 'idle' && onRequestIndex
    ? 'Click to index project'
    : status === 'error'
      ? 'Click to see error details'
      : buildProgressTitle(label, progress)

  return (
    <div className="relative">
      <button
        onClick={isClickable ? handleClick : undefined}
        disabled={!isClickable}
        className={`flex items-center gap-2 px-2 py-1 rounded-md text-[10px] font-semibold border ${c.text} ${c.bg} ${c.border} ${isClickable ? 'cursor-pointer hover:brightness-125 transition-all' : 'cursor-default'}`}
        title={title}
      >
        {status === 'indexing' ? (
          <span className="inline-block w-3 h-3 border-[1.5px] border-codefire-orange border-t-transparent rounded-full animate-spin" />
        ) : (
          <Code className="w-3 h-3" />
        )}
        <div className="flex flex-col items-start leading-none min-w-0">
          <span className="truncate">{label}</span>
          {progressCaption && (
            <span className="text-[9px] font-medium text-neutral-500 truncate max-w-40">
              {progressCaption}
            </span>
          )}
        </div>
        {progressPercent !== undefined && (
          <span className="flex items-center gap-1.5">
            <span className="w-14 h-1 rounded-full bg-neutral-800/80 overflow-hidden">
              <span
                className="block h-full rounded-full bg-codefire-orange transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </span>
            <span className="text-[9px] text-neutral-400">{progressPercent}%</span>
          </span>
        )}
      </button>

      {showError && status === 'error' && (
        <div className="absolute top-full right-0 mt-1 px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 max-w-72 z-50 shadow-lg">
          <p className="text-[11px] text-error break-words">{lastError || 'Unknown error'}</p>
        </div>
      )}
    </div>
  )
}

// --- Filesystem/Profile Indicator ---

function HeaderFilesystemIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold text-success bg-success/10 border border-success/30">
      <FolderOpen className="w-3 h-3" />
      <span>Filesystem</span>
    </div>
  )
}

function getProgressPercent(progress?: IndexProgress | null): number | undefined {
  if (!progress) return undefined

  switch (progress.phase) {
    case 'enumerating':
      return progress.filesTotal > 0 ? 5 : 0
    case 'indexing':
      return progress.filesTotal > 0
        ? Math.min(85, Math.round((progress.filesProcessed / progress.filesTotal) * 85))
        : 10
    case 'embedding':
      if (progress.embeddingsTotal === 0) return 90
      return Math.min(
        98,
        85 + Math.round((progress.embeddingsGenerated / progress.embeddingsTotal) * 13)
      )
    case 'finalizing':
      return 100
    default:
      return undefined
  }
}

function getProgressHeadline(progress?: IndexProgress | null): string {
  if (!progress) return 'Indexing...'

  switch (progress.phase) {
    case 'enumerating':
      return 'Scanning Files'
    case 'indexing':
      return `Indexing ${progress.filesProcessed}/${progress.filesTotal}`
    case 'git-history':
      return 'Reading Git History'
    case 'embedding':
      return progress.embeddingsTotal > 0
        ? `Embedding ${progress.embeddingsGenerated}/${progress.embeddingsTotal}`
        : 'Embedding Chunks'
    case 'finalizing':
      return 'Finalizing Index'
  }
}

function getProgressCaption(progress?: IndexProgress | null): string | null {
  if (!progress) return null

  if (progress.phase === 'indexing') {
    const parts = []
    if (progress.filesSkipped > 0) {
      parts.push(`${progress.filesSkipped} unchanged`)
    }
    if (progress.estimatedRemainingMs !== undefined && progress.estimatedRemainingMs > 0) {
      parts.push(`~${formatDuration(progress.estimatedRemainingMs)} left`)
    }
    return parts.join(' • ') || 'Processing files'
  }

  if (progress.phase === 'embedding' && progress.embeddingsFailed > 0) {
    return `${progress.embeddingsFailed} failed batch items`
  }

  return null
}

function buildProgressTitle(label: string, progress?: IndexProgress | null): string {
  if (!progress) return label

  const eta = progress.estimatedRemainingMs && progress.estimatedRemainingMs > 0
    ? ` — ETA ${formatDuration(progress.estimatedRemainingMs)}`
    : ''

  return `${label}${eta}`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}
