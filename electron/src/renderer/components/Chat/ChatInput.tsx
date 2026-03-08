import { Send, Loader2, Square, Paperclip, X, Image as ImageIcon } from 'lucide-react'
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
  return (
    <div className="px-3 py-2.5 border-t border-neutral-800 shrink-0">
      {/* Attachment previews */}
      {draftAttachments.length > 0 && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {draftAttachments.map((att) => (
            <div
              key={att.id}
              className="relative group rounded-lg border border-neutral-700 bg-neutral-800 overflow-hidden"
              style={{ width: 48, height: 48 }}
            >
              {att.kind === 'image' ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon size={16} className="text-neutral-500" />
                </div>
              )}
              <button
                onClick={() => onRemoveAttachment(att.id)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neutral-900 border border-neutral-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove attachment"
              >
                <X size={8} className="text-neutral-300" />
              </button>
              {att.source === 'screenshot' && (
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[7px] text-center text-neutral-300 py-0.5">
                  screenshot
                </span>
              )}
            </div>
          ))}
          <span className="text-[10px] text-neutral-500">
            {draftAttachments.length} attachment{draftAttachments.length > 1 ? 's' : ''}
            {!modelHasVision(chatModel) && (
              <span className="text-yellow-500 ml-1">(model lacks vision)</span>
            )}
          </span>
        </div>
      )}

      <div className="flex gap-2">
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
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange/50 resize-none max-h-24"
          placeholder={chatMode === 'agent' ? `Ask or command the agent...` : `Ask about ${projectName}...`}
          disabled={sending}
        />
        <input
          type="file"
          id="chat-file-input"
          className="hidden"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = reader.result as string
              const attachment: ChatAttachment = {
                id: crypto.randomUUID(),
                kind: 'image',
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
          className="px-2 py-2 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-lg transition-colors self-end"
          title="Attach image"
          disabled={sending}
        >
          <Paperclip size={14} />
        </button>
        {sending && chatMode === 'agent' && activeRunId ? (
          <button
            onClick={onCancel}
            className="px-3 py-2 bg-red-500/15 text-red-300 rounded-lg hover:bg-red-500/25 transition-colors self-end"
            title="Cancel active run"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={() => onSend()}
            disabled={(!input.trim() && draftAttachments.length === 0) || sending}
            className="px-3 py-2 bg-codefire-orange/20 text-codefire-orange rounded-lg hover:bg-codefire-orange/30 transition-colors disabled:opacity-40 self-end"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}
