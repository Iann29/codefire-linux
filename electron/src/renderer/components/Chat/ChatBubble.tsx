import { useState } from 'react'
import { Copy, ListTodo, StickyNote, Terminal, Wrench, ChevronDown, X, Download } from 'lucide-react'
import type { ChatMessageAttachment, TokenUsage } from '@shared/models'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolExecution {
  callId?: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'error'
}

// ─── ChatBubble Props ────────────────────────────────────────────────────────

export interface ChatBubbleProps {
  role: string
  content: string
  usage?: TokenUsage | null
  tools?: ToolExecution[]
  attachments?: ChatMessageAttachment[]
  onCopy: (content: string) => void
  onCreateTask: (content: string) => void
  onCreateNote: (content: string) => void
  onSendToTerminal: (content: string) => void
}

// ─── ChatBubble Component ────────────────────────────────────────────────────

export default function ChatBubble({
  role,
  content,
  usage,
  tools,
  attachments,
  onCopy,
  onCreateTask,
  onCreateNote,
  onSendToTerminal,
}: ChatBubbleProps) {
  const isUser = role === 'user'
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="relative max-w-[90%]">
        {/* Tool executions (collapsed by default) */}
        {tools && tools.length > 0 && (
          <div className="mb-1.5">
            <button
              onClick={() => setToolsExpanded(!toolsExpanded)}
              className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors py-0.5"
            >
              <Wrench size={10} className="text-neutral-600" />
              <span>{tools.length} tool{tools.length > 1 ? 's' : ''} used</span>
              <ChevronDown size={10} className={`transition-transform ${toolsExpanded ? 'rotate-180' : ''}`} />
            </button>
            {toolsExpanded && (
              <div className="mt-1 space-y-0.5">
                {tools.map((te, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700/30">
                    {te.status === 'error' ? (
                      <X size={9} className="text-red-500 shrink-0" />
                    ) : (
                      <Wrench size={9} className="text-neutral-600 shrink-0" />
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono truncate flex-1">
                      {te.name}
                    </span>
                    {te.status === 'done' && (
                      <span className="text-[9px] text-green-600/70 shrink-0">ok</span>
                    )}
                    {te.status === 'error' && (
                      <span className="text-[9px] text-red-500/70 shrink-0">err</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            isUser
              ? 'bg-codefire-orange/15 text-neutral-200 border border-codefire-orange/20'
              : 'bg-neutral-800/80 text-neutral-300 border border-neutral-700/40'
          }`}
        >
          <MarkdownContent content={content} />
          {attachments && attachments.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {attachments.map((att) => (
                <div key={att.id} className="rounded border border-neutral-700 overflow-hidden" style={{ width: 56, height: 56 }}>
                  {att.kind === 'image' ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="w-full h-full object-cover cursor-pointer hover:brightness-110 transition-[filter]"
                      onClick={() => setLightboxUrl(att.dataUrl)}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-[8px] text-neutral-500">{att.name}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer: actions + usage */}
        {!isUser && (
          <div className="flex items-center justify-between mt-1 min-h-[20px]">
            <div className="flex items-center gap-0.5">
              <ActionButton icon={<Copy size={10} />} title="Copy" onClick={() => onCopy(content)} />
              <ActionButton icon={<ListTodo size={10} />} title="Create Task" onClick={() => onCreateTask(content)} />
              <ActionButton icon={<StickyNote size={10} />} title="Add to Notes" onClick={() => onCreateNote(content)} />
              <ActionButton icon={<Terminal size={10} />} title="Copy to Clipboard" onClick={() => onSendToTerminal(content)} />
            </div>
            {usage && (usage.prompt_tokens || usage.completion_tokens) && (
              <span
                className="text-[9px] text-neutral-600 tabular-nums"
                title={`${usage.source === 'estimated' ? 'Estimated' : 'Exact'} usage. Input: ${usage.prompt_tokens ?? 0} | Output: ${usage.completion_tokens ?? 0}`}
              >
                {usage.source === 'estimated' ? '~' : ''}
                {usage.prompt_tokens ?? 0}↓ {usage.completion_tokens ?? 0}↑
              </span>
            )}
          </div>
        )}
      </div>

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => e.key === 'Escape' && setLightboxUrl(null)}
          role="button"
          tabIndex={0}
        >
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-neutral-800/80 text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors"
            onClick={() => setLightboxUrl(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ActionButton ────────────────────────────────────────────────────────────

function ActionButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors"
    >
      {icon}
    </button>
  )
}

// ─── Simple Markdown Rendering ───────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={i} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 my-1 overflow-x-auto text-[10px] text-neutral-300">
            <code>{codeBlockContent.trimEnd()}</code>
          </pre>
        )
        codeBlockContent = ''
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(<p key={i} className="font-semibold text-neutral-200 mt-2 mb-0.5">{formatInline(line.slice(4))}</p>)
    } else if (line.startsWith('## ')) {
      elements.push(<p key={i} className="font-semibold text-neutral-200 mt-2 mb-0.5">{formatInline(line.slice(3))}</p>)
    } else if (line.startsWith('# ')) {
      elements.push(<p key={i} className="font-bold text-neutral-100 mt-2 mb-1">{formatInline(line.slice(2))}</p>)
    } else if (line.match(/^[-*]\s/)) {
      elements.push(
        <p key={i} className="pl-3">
          <span className="text-neutral-600 mr-1">&bull;</span>
          {formatInline(line.replace(/^[-*]\s/, ''))}
        </p>
      )
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)/)
      if (match) {
        elements.push(
          <p key={i} className="pl-3">
            <span className="text-neutral-500 mr-1">{match[1]}.</span>
            {formatInline(match[2])}
          </p>
        )
      }
    } else if (line.startsWith('> ')) {
      elements.push(
        <p key={i} className="pl-2 border-l-2 border-neutral-600 text-neutral-400 italic">
          {formatInline(line.slice(2))}
        </p>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />)
    } else {
      elements.push(<p key={i} className="whitespace-pre-wrap">{formatInline(line)}</p>)
    }
  }

  if (inCodeBlock && codeBlockContent) {
    elements.push(
      <pre key="unclosed" className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 my-1 overflow-x-auto text-[10px] text-neutral-300">
        <code>{codeBlockContent.trimEnd()}</code>
      </pre>
    )
  }

  return <>{elements}</>
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/)
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/)
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/)

    const matches = [
      codeMatch ? { type: 'code', match: codeMatch, index: codeMatch[1].length } : null,
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch[1].length } : null,
      italicMatch ? { type: 'italic', match: italicMatch, index: italicMatch[1].length } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index)

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    const first = matches[0]!
    if (first.match![1]) parts.push(first.match![1])

    if (first.type === 'code') {
      parts.push(<code key={key++} className="bg-neutral-800 text-codefire-orange px-1 py-0.5 rounded text-[10px]">{first.match![2]}</code>)
    } else if (first.type === 'bold') {
      parts.push(<strong key={key++} className="font-semibold text-neutral-200">{first.match![2]}</strong>)
    } else if (first.type === 'italic') {
      parts.push(<em key={key++}>{first.match![2]}</em>)
    }
    remaining = remaining.slice(first.match![0].length)
  }

  return <>{parts}</>
}
