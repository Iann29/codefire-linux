import { ipcMain } from 'electron'
import { AgentService } from '../services/AgentService'
import { ProviderRouter } from '../services/providers/ProviderRouter'
import { OAuthEngine } from '../services/providers/OAuthEngine'
import { TokenStore } from '../services/providers/TokenStore'
import { readConfig } from '../services/ConfigStore'

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

  ipcMain.handle('agent:continue', (_event, payload: {
    conversationId: number
    projectId?: string | null
  }) => {
    return agentService.continueRun({
      conversationId: payload.conversationId,
      projectId: payload.projectId ?? null,
      senderWebContentsId: _event.sender.id,
    })
  })

  ipcMain.handle('agent:status', () => {
    return agentService.getStatus()
  })
}
