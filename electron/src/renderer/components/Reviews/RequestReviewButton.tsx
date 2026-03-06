import { useState } from 'react'
import { GitPullRequest, X } from 'lucide-react'
import { usePremium } from '@renderer/hooks/usePremium'
import { api } from '@renderer/lib/api'

interface RequestReviewButtonProps {
  projectId: string
  taskId: string
  onRequested?: () => void
}

export default function RequestReviewButton({ projectId, taskId, onRequested }: RequestReviewButtonProps) {
  const [open, setOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { status, members } = usePremium()

  // Filter out current user from the member list
  const otherMembers = members.filter((m) => m.userId !== status?.user?.id)

  const handleSubmit = async () => {
    if (!selectedUserId) return
    setSubmitting(true)
    try {
      await api.premium.requestReview({
        projectId,
        taskId,
        assignedTo: selectedUserId,
        comment: comment.trim() || undefined,
      })
      setOpen(false)
      setSelectedUserId('')
      setComment('')
      onRequested?.()
    } catch (err) {
      console.error('Failed to request review:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (!status?.authenticated || !status.team) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-neutral-400 hover:text-codefire-orange hover:bg-codefire-orange/10 transition-colors"
        title="Request review"
      >
        <GitPullRequest size={13} />
        Request Review
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div
            className="bg-neutral-900 border border-neutral-700 rounded-lg w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <span className="text-sm font-medium text-neutral-200">Request Review</span>
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-3 space-y-3">
              {/* Team member select */}
              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Assign to</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-codefire-orange transition-colors"
                >
                  <option value="">Select a team member...</option>
                  {otherMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user?.displayName || m.user?.email || m.userId}
                    </option>
                  ))}
                </select>
              </div>

              {/* Comment */}
              <div>
                <label className="text-[11px] text-neutral-500 block mb-1">Comment (optional)</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add context for the reviewer..."
                  rows={3}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-codefire-orange transition-colors resize-none placeholder:text-neutral-600"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-800">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!selectedUserId || submitting}
                className="px-3 py-1.5 rounded text-xs font-medium bg-codefire-orange text-white hover:bg-codefire-orange/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Submitting...' : 'Request Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
