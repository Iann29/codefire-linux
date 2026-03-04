interface DiffViewerProps {
  diff: string
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
  oldNum: number | null
  newNum: number | null
}

function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n')
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ type: 'header', content: line, oldNum: null, newNum: null })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), oldNum: null, newNum: newLine })
      newLine++
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line.slice(1), oldNum: oldLine, newNum: null })
      oldLine++
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', content: line.slice(1), oldNum: oldLine, newNum: newLine })
      oldLine++
      newLine++
    }
    // Skip diff metadata lines (diff --git, index, ---, +++)
  }

  return result
}

const LINE_STYLES: Record<string, string> = {
  add: 'bg-green-500/10',
  remove: 'bg-red-500/10',
  header: 'bg-blue-500/10',
  context: '',
}

const SIGN_MAP: Record<string, string> = {
  add: '+',
  remove: '-',
  header: '@@',
  context: ' ',
}

export default function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff.trim()) {
    return (
      <div className="px-3 py-2 text-xs text-neutral-600 italic">No diff available</div>
    )
  }

  const lines = parseDiff(diff)

  return (
    <div className="max-h-72 overflow-y-auto border border-neutral-800 rounded font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={`flex ${LINE_STYLES[line.type]}`}>
          <span className="w-10 text-right pr-1 text-neutral-600 select-none shrink-0">
            {line.oldNum ?? ''}
          </span>
          <span className="w-10 text-right pr-1 text-neutral-600 select-none shrink-0">
            {line.newNum ?? ''}
          </span>
          <span className="w-5 text-center text-neutral-500 select-none shrink-0">
            {SIGN_MAP[line.type]}
          </span>
          <span className="flex-1 px-1 whitespace-pre-wrap break-all">
            {line.type === 'header' ? (
              <span className="text-blue-400">{line.content}</span>
            ) : line.type === 'add' ? (
              <span className="text-green-300">{line.content}</span>
            ) : line.type === 'remove' ? (
              <span className="text-red-300">{line.content}</span>
            ) : (
              <span className="text-neutral-400">{line.content}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
