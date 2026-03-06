import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReviewRequest } from '@shared/premium-models'
import { api } from '@renderer/lib/api'

const POLL_INTERVAL = 30_000

export function useReviewRequests(projectId: string) {
  const [reviews, setReviews] = useState<ReviewRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchReviews = useCallback(async () => {
    try {
      setError(null)
      const data = await api.premium.listReviewRequests(projectId)
      setReviews(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load review requests')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    fetchReviews()

    intervalRef.current = setInterval(fetchReviews, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchReviews])

  const requestReview = useCallback(async (data: {
    projectId: string
    taskId: string
    assignedTo: string
    comment?: string
  }) => {
    const review = await api.premium.requestReview(data)
    setReviews((prev) => [review, ...prev])
    return review
  }, [])

  const resolveReview = useCallback(async (reviewId: string, status: 'approved' | 'changes_requested' | 'dismissed') => {
    const review = await api.premium.resolveReview(reviewId, status)
    setReviews((prev) =>
      prev.map((r) => (r.id === reviewId ? { ...r, status, resolvedAt: review.resolvedAt ?? new Date().toISOString() } : r))
    )
    return review
  }, [])

  return { reviews, loading, error, requestReview, resolveReview, refresh: fetchReviews }
}
