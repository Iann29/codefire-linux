import { useState, useCallback } from 'react'
import { api } from '@renderer/lib/api'
import type { ProjectContext } from '@shared/models'
import type { PromptClarificationResult, PromptGenerationResult } from '@shared/promptCompiler'

export interface ContextToggles {
  techStack: boolean
  gitBranch: boolean
  tasks: boolean
  memories: boolean
}

/**
 * Filter a ProjectContext object according to the enabled toggles.
 * Returns undefined if context is null or all toggles are off.
 */
function filterContext(
  ctx: ProjectContext | null,
  toggles: ContextToggles
): ProjectContext | undefined {
  if (!ctx) return undefined

  const anyEnabled = toggles.techStack || toggles.gitBranch || toggles.tasks || toggles.memories
  if (!anyEnabled) return undefined

  return {
    projectName: ctx.projectName,
    projectPath: ctx.projectPath,
    techStack: toggles.techStack ? ctx.techStack : [],
    gitBranch: toggles.gitBranch ? ctx.gitBranch : null,
    openTasks: toggles.tasks ? ctx.openTasks : [],
    memories: toggles.memories ? ctx.memories : [],
  }
}

export function usePromptCompiler() {
  const [clarification, setClarification] = useState<PromptClarificationResult | null>(null)
  const [generation, setGeneration] = useState<PromptGenerationResult | null>(null)
  const [clarifying, setClarifying] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [mode, setMode] = useState<'ai' | 'demo' | null>(null)
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)

  const fetchContext = useCallback(async (projectId: string) => {
    setContextLoading(true)
    try {
      const ctx = await api.promptCompiler.gatherContext(projectId)
      setProjectContext(ctx)
      return ctx
    } catch (err) {
      console.error('[usePromptCompiler] Failed to gather project context:', err)
      setProjectContext(null)
      return null
    } finally {
      setContextLoading(false)
    }
  }, [])

  const clarify = useCallback(
    async (originalBrief: string, model?: string, toggles?: ContextToggles) => {
      setClarifying(true)
      setWarning(null)
      setClarification(null)
      setGeneration(null)
      setMode(null)

      try {
        const filteredCtx = toggles ? filterContext(projectContext, toggles) : undefined

        const result = await api.promptCompiler.clarify({
          originalBrief,
          model,
          projectContext: filteredCtx,
        })

        setClarification(result.data)
        setMode(result.mode)

        if (result.warning) {
          setWarning(result.warning)
        }

        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setWarning(`Falha ao interpretar o briefing. ${message}`)
        throw err
      } finally {
        setClarifying(false)
      }
    },
    [projectContext]
  )

  const generate = useCallback(
    async (
      originalBrief: string,
      userCorrections: string,
      currentClarification: PromptClarificationResult,
      model?: string,
      toggles?: ContextToggles
    ) => {
      setGenerating(true)
      setWarning(null)
      setGeneration(null)

      try {
        const filteredCtx = toggles ? filterContext(projectContext, toggles) : undefined

        const result = await api.promptCompiler.generate({
          originalBrief,
          userCorrections,
          clarification: currentClarification,
          model,
          projectContext: filteredCtx,
        })

        setGeneration(result.data)
        setMode(result.mode)

        if (result.warning) {
          setWarning(result.warning)
        }

        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setWarning(`Falha ao gerar o prompt final. ${message}`)
        throw err
      } finally {
        setGenerating(false)
      }
    },
    [projectContext]
  )

  const reset = useCallback(() => {
    setClarification(null)
    setGeneration(null)
    setWarning(null)
    setMode(null)
  }, [])

  const clearGeneration = useCallback(() => {
    setGeneration(null)
  }, [])

  return {
    clarification,
    generation,
    clarifying,
    generating,
    warning,
    mode,
    projectContext,
    contextLoading,
    clarify,
    generate,
    clearGeneration,
    reset,
    fetchContext,
  }
}
