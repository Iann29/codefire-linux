import { ipcMain, BrowserWindow } from 'electron'
import { AgentService } from '../services/AgentService'
import { ProviderRouter } from '../services/providers/ProviderRouter'
import { OAuthEngine } from '../services/providers/OAuthEngine'
import { TokenStore } from '../services/providers/TokenStore'
import { readConfig } from '../services/ConfigStore'
import type { ChatCompletionRequest } from '../services/providers/BaseProvider'

const providerRouter = new ProviderRouter()
const tokenStore = new TokenStore()
const oauthEngine = new OAuthEngine(tokenStore)
providerRouter.setOAuthEngine(oauthEngine)
providerRouter.setTokenStore(tokenStore)

export { providerRouter, tokenStore, oauthEngine }

// ── Provider handlers (registered eagerly — renderer calls these on startup) ──

ipcMain.handle('provider:listModels', async () => {
  const config = readConfig()
  return providerRouter.listModels(config)
})

ipcMain.handle('provider:healthCheck', async () => {
  const config = readConfig()
  return providerRouter.healthCheck(config)
})

ipcMain.handle('provider:startOAuth', async (_event, providerId: string) => {
  return oauthEngine.startOAuthFlow(providerId)
})

ipcMain.handle('provider:submitOAuthCode', async (_event, providerId: string, code: string) => {
  return oauthEngine.submitOAuthCode(providerId, code)
})

ipcMain.handle('provider:saveDirectToken', async (_event, providerId: string, token: string) => {
  return oauthEngine.saveDirectToken(providerId, token)
})

ipcMain.handle('provider:listAccounts', async () => {
  return oauthEngine.listAccounts()
})

ipcMain.handle('provider:removeAccount', async (_event, providerId: string, accountIndex?: number) => {
  await oauthEngine.revokeTokens(providerId, accountIndex ?? 0)
  return { success: true }
})

ipcMain.handle('provider:getRateLimitState', () => {
  return providerRouter.getRateLimitState()
})

// ── Chat completion via ProviderRouter (for subscription providers in context mode) ──

ipcMain.handle('chat:providerCompletion', async (_event, payload: {
  messages: Array<{ role: string; content: string }>
  model: string
  maxTokens?: number
}) => {
  const config = readConfig()
  const request: ChatCompletionRequest = {
    model: payload.model,
    messages: payload.messages as ChatCompletionRequest['messages'],
    maxTokens: payload.maxTokens ?? 4096,
  }
  const response = await providerRouter.chatCompletion(config, request)
  return {
    content: response.choices?.[0]?.message?.content ?? '',
    usage: response.usage,
  }
})

// ── Agent handlers (registered when AgentService is ready) ──

export function registerAgentHandlers(agentService: AgentService): void {
  ipcMain.handle(
    'agent:start',
    (_event, payload: {
      conversationId: number
      userMessage: string
      projectId?: string | null
      projectName?: string
      model?: string
      apiKey?: string
      maxIterations?: number
      maxToolCalls?: number
      temperature?: number
      planEnforcement?: boolean
      contextCompaction?: boolean
    }) => {
      return agentService.startRun({
        conversationId: payload.conversationId,
        userMessage: payload.userMessage,
        projectId: payload.projectId ?? null,
        projectName: payload.projectName,
        model: payload.model,
        apiKey: payload.apiKey,
        maxIterations: payload.maxIterations ?? payload.maxToolCalls,
        temperature: payload.temperature,
        planEnforcement: payload.planEnforcement,
        contextCompaction: payload.contextCompaction,
        senderWebContentsId: _event.sender.id,
      })
    }
  )

  ipcMain.handle('agent:cancel', (_event, runId?: string) => {
    return agentService.cancelRun(runId)
  })

  ipcMain.handle('agent:status', () => {
    return agentService.getStatus()
  })
}
