import { useState, useCallback } from 'react'
import { api } from '@renderer/lib/api'

interface ClarificationData {
  understanding: string
  objective: string[]
  context: string[]
  constraints: string[]
  assumptions: string[]
  confirmationPrompt: string
  questions: string[]
}

interface GenerationData {
  finalPrompt: string
}

export function usePromptCompiler() {
  const [clarification, setClarification] = useState<ClarificationData | null>(null)
  const [generation, setGeneration] = useState<GenerationData | null>(null)
  const [clarifying, setClarifying] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [mode, setMode] = useState<'ai' | 'demo' | null>(null)

  const clarify = useCallback(
    async (originalBrief: string, model?: string) => {
      setClarifying(true)
      setWarning(null)
      setClarification(null)
      setGeneration(null)
      setMode(null)

      try {
        const result = await api.promptCompiler.clarify({
          originalBrief,
          model,
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
    []
  )

  const generate = useCallback(
    async (
      originalBrief: string,
      userCorrections: string,
      currentClarification: ClarificationData,
      model?: string
    ) => {
      setGenerating(true)
      setWarning(null)
      setGeneration(null)

      try {
        const result = await api.promptCompiler.generate({
          originalBrief,
          userCorrections,
          clarification: currentClarification,
          model,
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
    []
  )

  const reset = useCallback(() => {
    setClarification(null)
    setGeneration(null)
    setWarning(null)
    setMode(null)
  }, [])

  return {
    clarification,
    generation,
    clarifying,
    generating,
    warning,
    mode,
    clarify,
    generate,
    reset,
  }
}
