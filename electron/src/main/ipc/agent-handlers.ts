import { ipcMain } from 'electron'
import { AgentService } from '../services/AgentService'

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
