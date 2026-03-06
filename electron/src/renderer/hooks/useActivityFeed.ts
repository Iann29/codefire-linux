import { useState, useEffect, useCallback, useRef } from 'react'
import type { ActivityEvent } from '@shared/premium-models'
import { api } from '@renderer/lib/api'

const POLL_INTERVAL = 30_000

export function useActivityFeed(projectId: string) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEvents = useCallback(async () => {
    try {
      setError(null)
      const data = await api.premium.getActivityFeed(projectId)
      setEvents(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load activity feed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    fetchEvents()

    intervalRef.current = setInterval(fetchEvents, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchEvents])

  return { events, loading, error, refresh: fetchEvents }
}
