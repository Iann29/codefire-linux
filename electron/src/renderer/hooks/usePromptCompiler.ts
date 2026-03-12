import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  promptCompilerStore,
  type ContextToggles,
} from '@renderer/stores/promptCompilerStore'

export type { ContextToggles } from '@renderer/stores/promptCompilerStore'

export function usePromptCompiler(projectId: string) {
  const state = useSyncExternalStore(
    promptCompilerStore.subscribe,
    () => promptCompilerStore.getState(projectId),
    () => promptCompilerStore.getState(projectId)
  )

  useEffect(() => {
    promptCompilerStore.ensureRecovered(projectId)
  }, [projectId])

  const setBrief = useCallback(
    (brief: string) => {
      promptCompilerStore.setBrief(projectId, brief)
    },
    [projectId]
  )

  const setManualAdjustments = useCallback(
    (manualAdjustments: string) => {
      promptCompilerStore.setManualAdjustments(projectId, manualAdjustments)
    },
    [projectId]
  )

  const setGuidedAnswer = useCallback(
    (answer: Parameters<typeof promptCompilerStore.setGuidedAnswer>[1]) => {
      promptCompilerStore.setGuidedAnswer(projectId, answer)
    },
    [projectId]
  )

  const setSelectedModel = useCallback(
    (selectedModel: string) => {
      promptCompilerStore.setSelectedModel(projectId, selectedModel)
    },
    [projectId]
  )

  const setContextOpen = useCallback(
    (contextOpen: boolean) => {
      promptCompilerStore.setContextOpen(projectId, contextOpen)
    },
    [projectId]
  )

  const toggleContextSetting = useCallback(
    (key: keyof ContextToggles) => {
      promptCompilerStore.toggleContextSetting(projectId, key)
    },
    [projectId]
  )

  const fetchContext = useCallback(() => promptCompilerStore.fetchContext(projectId), [projectId])
  const clarify = useCallback(() => promptCompilerStore.clarify(projectId), [projectId])
  const generate = useCallback(
    (userCorrections: string) => promptCompilerStore.generate(projectId, userCorrections),
    [projectId]
  )
  const clearGeneration = useCallback(() => promptCompilerStore.clearGeneration(projectId), [projectId])
  const reset = useCallback(() => promptCompilerStore.reset(projectId), [projectId])

  return {
    ...state,
    setBrief,
    setManualAdjustments,
    setGuidedAnswer,
    setSelectedModel,
    setContextOpen,
    toggleContextSetting,
    fetchContext,
    clarify,
    generate,
    clearGeneration,
    reset,
  }
}
