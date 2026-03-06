import { useState, useEffect, useCallback, useRef } from 'react'
import type { SessionSummary } from '@shared/premium-models'
import { api } from '@renderer/lib/api'

const POLL_INTERVAL = 30_000

export function useSessionSummaries(projectId: string) {
  const [summaries, setSummaries] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSummaries = useCallback(async () => {
    try {
      setError(null)
      const data = await api.premium.listSessionSummaries(projectId)
      setSummaries(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load session summaries')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    fetchSummaries()

    intervalRef.current = setInterval(fetchSummaries, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchSummaries])

  return { summaries, loading, error, refresh: fetchSummaries }
}
