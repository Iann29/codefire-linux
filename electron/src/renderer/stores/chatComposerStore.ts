/**
 * Shared store for chat composer state — survives CodeFireChat mount/unmount.
 * BrowserView writes attachments here; CodeFireChat consumes them.
 */
import type { ChatAttachment } from '@shared/models'

type Listener = () => void

let _pendingAttachments: ChatAttachment[] = []
let _requestOpen = false
const _listeners = new Set<Listener>()

function notify() {
  _listeners.forEach(fn => fn())
}

export const chatComposerStore = {
  /** Add an attachment (from screenshot, paste, etc.) */
  addAttachment(att: ChatAttachment) {
    _pendingAttachments = [..._pendingAttachments, att]
    _requestOpen = true
    notify()
  },

  /** Get and clear pending attachments */
  consumeAttachments(): ChatAttachment[] {
    const result = _pendingAttachments
    _pendingAttachments = []
    notify()
    return result
  },

  /** Check and clear the open request flag */
  consumeOpenRequest(): boolean {
    if (_requestOpen) {
      _requestOpen = false
      return true
    }
    return false
  },

  /** Get current pending attachments without consuming */
  getPendingAttachments(): ChatAttachment[] {
    return _pendingAttachments
  },

  /** Whether there are pending attachments */
  hasPending(): boolean {
    return _pendingAttachments.length > 0
  },

  /** Subscribe to changes */
  subscribe(listener: Listener): () => void {
    _listeners.add(listener)
    return () => _listeners.delete(listener)
  },
}
