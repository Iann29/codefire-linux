import { GitPullRequest, RefreshCw } from 'lucide-react'
import { useReviewRequests } from '@renderer/hooks/useReviewRequests'
import { usePremium } from '@renderer/hooks/usePremium'
import ReviewRequestCard from '@renderer/components/Reviews/ReviewRequestCard'
import type { ReviewRequest } from '@shared/premium-models'

interface ReviewsViewProps {
  projectId: string
}

export default function ReviewsView({ projectId }: ReviewsViewProps) {
  const { reviews, loading, error, resolveReview, refresh } = useReviewRequests(projectId)
  const { status } = usePremium()

  const currentUserId = status?.user?.id

  const pendingReviews = reviews.filter((r) => r.status === 'pending')
  const resolvedReviews = reviews.filter((r) => r.status !== 'pending')

  const handleResolve = async (reviewId: string, resolveStatus: 'approved' | 'changes_requested' | 'dismissed') => {
    try {
      await resolveReview(reviewId, resolveStatus)
    } catch (err) {
      console.error('Failed to resolve review:', err)
    }
  }

  if (loading && reviews.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
      </div>
    )
  }

  if (error && reviews.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} className="text-neutral-400" />
          <span className="text-xs font-medium text-neutral-300">Review Requests</span>
          <span className="text-[10px] text-neutral-600">{reviews.length} total</span>
        </div>
        <button
          onClick={refresh}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <GitPullRequest size={28} className="text-neutral-700 mb-3" />
            <p className="text-xs text-neutral-500">No review requests yet</p>
            <p className="text-[10px] text-neutral-600 mt-1">
              Request reviews from team members on tasks to get feedback
            </p>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-6">
            {/* Pending section */}
            {pendingReviews.length > 0 && (
              <ReviewSection
                title="Pending"
                count={pendingReviews.length}
                reviews={pendingReviews}
                currentUserId={currentUserId}
                onResolve={handleResolve}
              />
            )}

            {/* Resolved section */}
            {resolvedReviews.length > 0 && (
              <ReviewSection
                title="Resolved"
                count={resolvedReviews.length}
                reviews={resolvedReviews}
                currentUserId={currentUserId}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewSection({
  title,
  count,
  reviews,
  currentUserId,
  onResolve,
}: {
  title: string
  count: number
  reviews: ReviewRequest[]
  currentUserId?: string
  onResolve?: (reviewId: string, status: 'approved' | 'changes_requested' | 'dismissed') => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">{title}</span>
        <span className="text-[10px] text-neutral-600">{count}</span>
      </div>
      <div className="space-y-2">
        {reviews.map((review) => (
          <ReviewRequestCard
            key={review.id}
            review={review}
            currentUserId={currentUserId}
            onResolve={onResolve}
          />
        ))}
      </div>
    </div>
  )
}
