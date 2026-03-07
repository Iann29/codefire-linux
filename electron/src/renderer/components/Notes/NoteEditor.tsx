import { useState, useEffect, useRef } from 'react'
import { Pin, PinOff, Trash2, Eye, Pencil } from 'lucide-react'
import type { Note } from '@shared/models'
import { useAutoSave } from '@renderer/hooks/useNotes'

interface NoteEditorProps {
  note: Note | null
  onUpdate: (id: number, data: { title?: string; content?: string; pinned?: boolean }) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onTogglePin: (note: Note) => Promise<void>
}

export default function NoteEditor({ note, onUpdate, onDelete, onTogglePin }: NoteEditorProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync state when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content || '')
      setPreview(false)
    }
  }, [note?.id])

  // Auto-save content with 1s debounce
  const autoSave = useAutoSave(note?.id ?? null, onUpdate, 1000)

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Select a note to edit, or create a new one
      </div>
    )
  }

  const handleContentChange = (value: string) => {
    setContent(value)
    autoSave(value)
  }

  const handleTitleBlur = () => {
    if (title !== note.title && title.trim()) {
      onUpdate(note.id, { title })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newContent = content.substring(0, start) + '  ' + content.substring(end)
      handleContentChange(newContent)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <input
          className="flex-1 bg-transparent text-title text-neutral-100 font-medium
                     focus:outline-none placeholder-neutral-500"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Note title..."
        />
        <button
          className={`p-1.5 rounded-cf transition-colors ${
            preview ? 'text-codefire-orange bg-codefire-orange/10' : 'text-neutral-500 hover:text-neutral-300'
          }`}
          onClick={() => setPreview(!preview)}
          title={preview ? 'Edit' : 'Preview'}
        >
          {preview ? <Pencil size={14} /> : <Eye size={14} />}
        </button>
        <button
          className={`p-1.5 rounded-cf transition-colors
            ${note.pinned ? 'text-codefire-orange hover:text-codefire-orange-hover' : 'text-neutral-500 hover:text-neutral-300'}`}
          onClick={() => onTogglePin(note)}
          title={note.pinned ? 'Unpin note' : 'Pin note'}
        >
          {note.pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button
          className="p-1.5 rounded-cf text-neutral-500 hover:text-red-400 transition-colors"
          onClick={() => {
            if (confirm('Delete this note?')) onDelete(note.id)
          }}
          title="Delete note"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 overflow-hidden">
        {preview ? (
          <div
            className="h-full overflow-y-auto p-4 prose prose-invert prose-sm max-w-none
                       prose-headings:text-neutral-200 prose-p:text-neutral-300
                       prose-a:text-codefire-orange prose-code:text-codefire-orange
                       prose-pre:bg-neutral-800 prose-pre:border prose-pre:border-neutral-700"
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            className="w-full h-full resize-none bg-transparent text-sm text-neutral-200
                       font-mono p-4 focus:outline-none placeholder-neutral-600"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write your note in markdown..."
            spellCheck={false}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-neutral-800 shrink-0">
        <span className="text-xs text-neutral-600">
          Updated{' '}
          {new Date(note.updatedAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span className="text-xs text-neutral-600">
          {content.length} chars
        </span>
      </div>
    </div>
  )
}

/** Lightweight markdown → HTML (covers common patterns without heavy deps) */
function simpleMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false
  let inList = false

  for (const raw of lines) {
    if (raw.startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        if (inList) { out.push('</ul>'); inList = false }
        out.push('<pre><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(escape(raw))
      continue
    }

    let line = escape(raw)

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (hMatch) {
      if (inList) { out.push('</ul>'); inList = false }
      const level = hMatch[1].length
      out.push(`<h${level}>${inline(hMatch[2])}</h${level}>`)
      continue
    }

    // List items
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }

    if (inList && line.trim() === '') {
      out.push('</ul>')
      inList = false
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      out.push('<hr />')
      continue
    }

    // Paragraph
    if (line.trim()) {
      out.push(`<p>${inline(line)}</p>`)
    }
  }

  if (inCode) out.push('</code></pre>')
  if (inList) out.push('</ul>')

  return out.join('\n')
}

/** Inline markdown: bold, italic, code, links */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}
