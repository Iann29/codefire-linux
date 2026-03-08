import { Folder } from 'lucide-react'
import IndexIndicator from './IndexIndicator'

interface AgentStatusBarProps {
  projectId: string
  projectPath?: string
  indexStatus?: 'idle' | 'indexing' | 'ready' | 'error'
  indexTotalChunks?: number
  indexProgress?: number
  indexLastError?: string
  onRequestIndex?: () => void
}

/** Truncate a file path to show only the last N segments. */
function truncatePath(path: string, maxSegments = 3): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= maxSegments) return path
  return '.../' + segments.slice(-maxSegments).join('/')
}

export default function AgentStatusBar({
  projectPath,
  indexStatus = 'idle',
  indexTotalChunks,
  indexProgress,
  indexLastError,
  onRequestIndex,
}: AgentStatusBarProps) {
  return (
    <div
      className="
        w-full h-7 flex-shrink-0 flex items-center justify-between
        px-3 bg-neutral-950 border-t border-neutral-800
        no-drag
      "
    >
      {/* Left: Index indicator */}
      <div className="flex items-center">
        <IndexIndicator
          status={indexStatus}
          totalChunks={indexTotalChunks}
          progress={indexProgress}
          lastError={indexLastError}
          onRequestIndex={onRequestIndex}
        />
      </div>

      {/* Right: Project path + version */}
      <div className="flex items-center gap-3 cursor-default min-w-0">
        {projectPath && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Folder className="w-3 h-3 text-neutral-600 flex-shrink-0" />
            <span
              className="text-tiny text-neutral-600 font-mono truncate max-w-48"
              title={projectPath}
            >
              {truncatePath(projectPath)}
            </span>
          </div>
        )}
        <span className="text-tiny text-neutral-700 font-mono flex-shrink-0">
          v{__APP_VERSION__}
        </span>
      </div>
    </div>
  )
}
