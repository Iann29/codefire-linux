import { useState, useLayoutEffect } from 'react'
import { Send, Loader2, Square, Paperclip, X, FileText } from 'lucide-react'
import type { ChatAttachment } from '@shared/models'
import { modelHasVision } from './ChatHeader'

// ─── ChatInput Props ─────────────────────────────────────────────────────────

export interface ChatInputProps {
  input: string
  onInputChange: (value: string) => void
  onSend: (content?: string) => void
  onCancel: () => void
  sending: boolean
  streaming: boolean
  chatMode: 'context' | 'agent'
  chatModel: string
  activeRunId: string | null
  draftAttachments: ChatAttachment[]
  onAddAttachment: (att: ChatAttachment) => void
  onRemoveAttachment: (id: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  projectName: string
}

// ─── ChatInput Component ─────────────────────────────────────────────────────

export default function ChatInput({
  input,
  onInputChange,
  onSend,
  onCancel,
  sending,
  chatMode,
  chatModel,
  activeRunId,
  draftAttachments,
  onAddAttachment,
  onRemoveAttachment,
  inputRef,
  projectName,
}: ChatInputProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useLayoutEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return

    textarea.style.height = '40px'
    const nextHeight = Math.min(textarea.scrollHeight, 220)
    textarea.style.height = `${Math.max(40, nextHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > 220 ? 'auto' : 'hidden'
  }, [input, inputRef])

  const hasAttachments = draftAttachments.length > 0
  const hasMultipleLines = input.includes('\n') || input.length > 72

  return (
    <div className="px-3 py-2.5 border-t border-neutral-800 shrink-0 bg-neutral-950/40 backdrop-blur-sm">
      {/* Attachment previews */}
      <div
        className={`rounded-2xl border px-2.5 py-2 transition-all duration-200 ${
          hasAttachments || hasMultipleLines
            ? 'border-neutral-700 bg-neutral-900/85 shadow-[0_10px_30px_rgba(0,0,0,0.25)]'
            : 'border-neutral-800 bg-neutral-900/65'
        } focus-within:border-codefire-orange/40 focus-within:bg-neutral-900/95 focus-within:shadow-[0_16px_40px_rgba(0,0,0,0.32)]`}
      >
      {hasAttachments && (
        <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
          {draftAttachments.map((att) => (
            <div
              key={att.id}
              className="relative group flex h-14 min-w-[168px] items-center gap-2 overflow-hidden rounded-xl border border-neutral-700/80 bg-neutral-900/80 px-2 py-2"
            >
              {att.kind === 'image' ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="h-10 w-10 rounded-lg object-cover cursor-pointer hover:brightness-110 transition-[filter]"
                  onClick={() => setLightboxUrl(att.dataUrl)}
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800">
                  <FileText size={16} className="text-neutral-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-neutral-200">{att.name}</div>
                <div className="truncate text-[10px] text-neutral-500">
                  {att.source === 'screenshot' ? 'screenshot' : att.mimeType || 'attachment'}
                </div>
              </div>
              <button
                onClick={() => onRemoveAttachment(att.id)}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-neutral-600 bg-neutral-950/90 opacity-0 transition-opacity group-hover:opacity-100"
                title="Remove attachment"
              >
                <X size={8} className="text-neutral-300" />
              </button>
            </div>
          ))}
          <span className="shrink-0 rounded-full border border-neutral-700 bg-neutral-950/80 px-2.5 py-1 text-[10px] text-neutral-400">
            {draftAttachments.length} attachment{draftAttachments.length > 1 ? 's' : ''}
            {draftAttachments.some((att) => att.kind === 'image') && !modelHasVision(chatModel) && (
              <span className="text-yellow-500 ml-1">(model lacks vision)</span>
            )}
          </span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items
            if (!items) return
            for (let i = 0; i < items.length; i++) {
              const item = items[i]
              if (item.type.startsWith('image/')) {
                e.preventDefault()
                const file = item.getAsFile()
                if (!file) continue
                const reader = new FileReader()
                reader.onload = () => {
                  const dataUrl = reader.result as string
                  const attachment: ChatAttachment = {
                    id: crypto.randomUUID(),
                    kind: 'image',
                    name: `pasted-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
                    mimeType: file.type,
                    dataUrl,
                    source: 'paste',
                  }
                  onAddAttachment(attachment)
                }
                reader.readAsDataURL(file)
                break
              }
            }
          }}
          rows={1}
          className="flex-1 min-h-[40px] max-h-[220px] resize-none rounded-xl bg-transparent px-2.5 py-2 text-xs leading-5 text-neutral-100 placeholder-neutral-500 outline-none transition-[height] duration-150"
          placeholder={chatMode === 'agent' ? `Ask or command the agent...` : `Ask about ${projectName}...`}
          disabled={sending}
        />
        <input
          type="file"
          id="chat-file-input"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = reader.result as string
              const attachment: ChatAttachment = {
                id: crypto.randomUUID(),
                kind: file.type.startsWith('image/') ? 'image' : 'file',
                name: file.name,
                mimeType: file.type,
                dataUrl,
                source: 'upload',
              }
              onAddAttachment(attachment)
            }
            reader.readAsDataURL(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => document.getElementById('chat-file-input')?.click()}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950/80 text-neutral-500 transition-colors hover:border-neutral-700 hover:text-neutral-300"
          title="Attach file"
          disabled={sending}
        >
          <Paperclip size={14} />
        </button>
        {sending && chatMode === 'agent' && activeRunId ? (
          <button
            onClick={onCancel}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/15 text-red-300 transition-colors hover:bg-red-500/25"
            title="Cancel active run"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={() => onSend()}
            disabled={(!input.trim() && draftAttachments.length === 0) || sending}
            className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-codefire-orange/20 bg-codefire-orange/20 px-3 text-codefire-orange transition-colors hover:bg-codefire-orange/30 disabled:opacity-40"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        )}
      </div>
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
