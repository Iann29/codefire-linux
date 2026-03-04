import { Plus, Minus } from 'lucide-react'

interface FileRowProps {
  status: string
  path: string
  isExpanded: boolean
  action: 'stage' | 'unstage'
  onClick: () => void
  onAction: () => void
}

const STATUS_COLORS: Record<string, string> = {
  M: 'bg-orange-500/20 text-orange-400',
  A: 'bg-green-500/20 text-green-400',
  D: 'bg-red-500/20 text-red-400',
  R: 'bg-blue-500/20 text-blue-400',
  '?': 'bg-neutral-500/20 text-neutral-400',
}

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || STATUS_COLORS['?']
}

export default function FileRow({
  status,
  path,
  isExpanded,
  action,
  onClick,
  onAction,
}: FileRowProps) {
  const lastSlash = path.lastIndexOf('/')
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : ''
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
        isExpanded ? 'bg-neutral-800/60' : 'hover:bg-neutral-800/40'
      }`}
      onClick={onClick}
    >
      <span
        className={`text-[10px] font-mono rounded px-1 py-0.5 leading-none shrink-0 ${getStatusColor(status)}`}
      >
        {status}
      </span>
      <span className="flex-1 min-w-0 truncate text-sm">
        {dir && <span className="text-neutral-600">{dir}</span>}
        <span className="text-neutral-300">{filename}</span>
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onAction()
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-neutral-700 transition-all text-neutral-400 hover:text-neutral-200 shrink-0"
        title={action === 'stage' ? 'Stage file' : 'Unstage file'}
      >
        {action === 'stage' ? <Plus size={12} /> : <Minus size={12} />}
      </button>
    </div>
  )
}
