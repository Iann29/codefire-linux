import { ipcMain } from 'electron'
import { providerRouter } from './agent-handlers'
import { readConfig } from '../services/ConfigStore'
import type { ChatCompletionRequest } from '../services/providers/BaseProvider'
import {
  normalizePromptPayload,
  buildClarifyRequest,
  buildGenerateRequest,
  buildClarificationFallback,
  buildGenerationFallback,
  sanitizeClarifyResponse,
  sanitizeGenerateResponse,
  extractJson,
} from '../services/PromptCompilerService'
import type { ClarificationResult, GenerationResult } from '../services/PromptCompilerService'

export function registerPromptHandlers() {
  ipcMain.handle(
    'prompt:clarify',
    async (
      _event,
      payload: {
        originalBrief: string
        taskMode?: string
        userCorrections?: string
        model?: string
      }
    ): Promise<{
      mode: 'ai' | 'demo'
      data: ClarificationResult
      warning?: string
    }> => {
      const normalized = normalizePromptPayload(payload)

      // If no model specified, use demo fallback
      if (!payload.model) {
        return {
          mode: 'demo',
          data: buildClarificationFallback(normalized),
        }
      }

      // Try AI path via ProviderRouter
      try {
        const config = readConfig()
        const promptReq = buildClarifyRequest(normalized)

        const request: ChatCompletionRequest = {
          model: payload.model,
          messages: [
            { role: 'system', content: promptReq.instructions },
            { role: 'user', content: promptReq.input },
          ],
          maxTokens: 4096,
        }

        const response = await providerRouter.chatCompletion(config, request)
        const content = String(response.choices?.[0]?.message?.content ?? '')

        if (!content) {
          throw new Error('Provider returned an empty completion.')
        }

        const parsed = extractJson(content)
        return {
          mode: 'ai' as const,
          data: sanitizeClarifyResponse(parsed, normalized),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          mode: 'demo' as const,
          data: buildClarificationFallback(normalized),
          warning: `AI request failed, using local fallback. ${message}`,
        }
      }
    }
  )

  ipcMain.handle(
    'prompt:generate',
    async (
      _event,
      payload: {
        originalBrief: string
        taskMode?: string
        userCorrections?: string
        clarification?: unknown
        model?: string
      }
    ): Promise<{
      mode: 'ai' | 'demo'
      data: GenerationResult
      warning?: string
    }> => {
      const normalized = normalizePromptPayload(payload)

      // If no model specified, use demo fallback
      if (!payload.model) {
        return {
          mode: 'demo',
          data: buildGenerationFallback(normalized),
        }
      }

      // Try AI path via ProviderRouter
      try {
        const config = readConfig()
        const promptReq = buildGenerateRequest(normalized)

        const request: ChatCompletionRequest = {
          model: payload.model,
          messages: [
            { role: 'system', content: promptReq.instructions },
            { role: 'user', content: promptReq.input },
          ],
          maxTokens: 8192,
        }

        const response = await providerRouter.chatCompletion(config, request)
        const content = String(response.choices?.[0]?.message?.content ?? '')

        if (!content) {
          throw new Error('Provider returned an empty completion.')
        }

        const parsed = extractJson(content)
        return {
          mode: 'ai' as const,
          data: sanitizeGenerateResponse(parsed, normalized),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          mode: 'demo' as const,
          data: buildGenerationFallback(normalized),
          warning: `AI request failed, using local fallback. ${message}`,
        }
      }
    }
  )
}
