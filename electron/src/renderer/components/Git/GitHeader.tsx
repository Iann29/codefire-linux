import { GitBranch, RefreshCw } from 'lucide-react'

interface GitHeaderProps {
  branch: string
  changeCount: number
  loading: boolean
  onRefresh: () => void
}

export default function GitHeader({ branch, changeCount, loading, onRefresh }: GitHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
      <GitBranch size={16} className="text-codefire-orange shrink-0" />
      <span className="font-mono text-sm text-codefire-orange truncate">
        {branch || 'unknown'}
      </span>
      {changeCount > 0 && (
        <span className="text-[10px] bg-codefire-orange/20 text-codefire-orange rounded-full px-2 py-0.5 leading-none font-medium">
          {changeCount}
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="p-1.5 rounded hover:bg-neutral-800/60 transition-colors text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
        title="Refresh git status"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}
