import { Check, X, MessageSquare, ArrowRight } from 'lucide-react'
import type { ReviewRequest } from '@shared/premium-models'

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function UserAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="w-6 h-6 rounded-full object-cover"
      />
    )
  }

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="w-6 h-6 rounded-full bg-neutral-700 flex items-center justify-center text-[10px] font-medium text-neutral-300">
      {initials}
    </div>
  )
}

const statusConfig = {
  pending: { label: 'Pending', bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  approved: { label: 'Approved', bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  changes_requested: { label: 'Changes Requested', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  dismissed: { label: 'Dismissed', bg: 'bg-neutral-500/10', text: 'text-neutral-400', border: 'border-neutral-500/20' },
} as const

interface ReviewRequestCardProps {
  review: ReviewRequest
  currentUserId?: string
  taskTitle?: string
  onResolve?: (reviewId: string, status: 'approved' | 'changes_requested' | 'dismissed') => void
}

export default function ReviewRequestCard({ review, currentUserId, taskTitle, onResolve }: ReviewRequestCardProps) {
  const status = statusConfig[review.status]
  const isAssignee = currentUserId === review.assignedTo
  const isPending = review.status === 'pending'
  const requesterName = review.requestedByUser?.displayName || review.requestedByUser?.email || 'Unknown'
  const assigneeName = review.assignedToUser?.displayName || review.assignedToUser?.email || 'Unknown'

  return (
    <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/50 hover:bg-neutral-800/30 transition-colors">
      {/* Header: requester -> assignee + status */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserAvatar name={requesterName} avatarUrl={review.requestedByUser?.avatarUrl} />
          <span className="text-xs text-neutral-300 truncate">{requesterName}</span>
          <ArrowRight size={12} className="text-neutral-600 shrink-0" />
          <UserAvatar name={assigneeName} avatarUrl={review.assignedToUser?.avatarUrl} />
          <span className="text-xs text-neutral-300 truncate">{assigneeName}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${status.bg} ${status.text} ${status.border}`}>
          {status.label}
        </span>
      </div>

      {/* Task title */}
      {taskTitle && (
        <p className="text-xs text-neutral-400 mb-1.5 truncate">
          Task: <span className="text-neutral-300">{taskTitle}</span>
        </p>
      )}

      {/* Comment */}
      {review.comment && (
        <div className="flex items-start gap-1.5 mb-2">
          <MessageSquare size={11} className="text-neutral-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-neutral-400 line-clamp-2">{review.comment}</p>
        </div>
      )}

      {/* Footer: time + action buttons */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-neutral-600">{formatRelativeTime(review.createdAt)}</span>

        {isPending && isAssignee && onResolve && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onResolve(review.id, 'approved')}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-colors"
            >
              <Check size={10} />
              Approve
            </button>
            <button
              onClick={() => onResolve(review.id, 'changes_requested')}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
            >
              <X size={10} />
              Changes
            </button>
            <button
              onClick={() => onResolve(review.id, 'dismissed')}
              className="px-2 py-0.5 rounded text-[10px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
