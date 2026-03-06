import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@renderer/lib/api'
import type { Notification } from '@shared/premium-models'

const POLL_INTERVAL = 30_000 // 30 seconds

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [premiumEnabled, setPremiumEnabled] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.premium.getNotifications(50)
      setNotifications(data)
    } catch {
      // Premium not available or not authenticated — silently ignore
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const status = await api.premium.getStatus()
        if (cancelled) return
        if (!status.enabled || !status.authenticated) {
          setPremiumEnabled(false)
          setLoading(false)
          return
        }
        setPremiumEnabled(true)
        await fetchNotifications()
      } catch {
        // Premium not configured
      }
      if (!cancelled) setLoading(false)
    }

    init()

    return () => {
      cancelled = true
    }
  }, [fetchNotifications])

  // Poll for new notifications
  useEffect(() => {
    if (!premiumEnabled) return

    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [premiumEnabled, fetchNotifications])

  const unreadCount = notifications.filter((n) => !n.isRead).length

  const markRead = useCallback(async (id: string) => {
    await api.premium.markNotificationRead(id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    )
  }, [])

  const markAllRead = useCallback(async () => {
    await api.premium.markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
  }, [])

  const refresh = useCallback(() => fetchNotifications(), [fetchNotifications])

  return { notifications, unreadCount, loading, premiumEnabled, markRead, markAllRead, refresh }
}
