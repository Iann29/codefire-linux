import { useState, useEffect, useCallback } from 'react'
import type { ProviderModelGroup } from '@shared/models'
import { api } from '@renderer/lib/api'

/**
 * Hook that fetches all available AI models from connected providers.
 * Returns grouped models by provider, loading state, and a refresh function.
 *
 * Both the Prompt area and Chat area model selectors should use this hook
 * to ensure they dynamically display ONLY models from connected providers.
 */
export function useAvailableModels() {
  const [groups, setGroups] = useState<ProviderModelGroup[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.provider.listAllModels()
      setGroups(result)
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for provider connection/disconnection events to auto-refresh
  useEffect(() => {
    const handleRateLimitCleared = () => {
      // Provider recovered — refresh models
      refresh()
    }

    const cleanup = window.api.on('provider:rateLimitCleared', handleRateLimitCleared)
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [refresh])

  // Flat list of all models across all providers
  const allModels = groups.flatMap((g) => g.models)

  // Set of connected provider IDs for quick lookup
  const connectedProviderIds = new Set(groups.map((g) => g.providerId))

  return {
    /** Model groups organized by provider */
    groups,
    /** Flat list of all available models */
    allModels,
    /** Set of provider IDs that are currently connected */
    connectedProviderIds,
    /** Whether the initial load is in progress */
    loading,
    /** Refresh the model list (e.g., after provider config changes) */
    refresh,
  }
}
