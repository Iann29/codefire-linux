import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { providerRouter } from './agent-handlers'
import { readConfig } from '../services/ConfigStore'
import type { ChatCompletionRequest } from '../services/providers/BaseProvider'
import { ClaudeSubscriptionAdapter } from '../services/providers/ClaudeSubscriptionAdapter'
import type {
  ChatAttachment,
  ChatEffortLevel,
  ChatMessage,
  RunUsageSnapshot,
  TokenUsage,
} from '@shared/models'

function parseUsageJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function hydrateChatMessage(row: Record<string, unknown>): ChatMessage {
  const hydrated = { ...row } as ChatMessage & Record<string, unknown>
  hydrated.responseUsage = parseUsageJson<TokenUsage>(row.responseUsageJson)
  hydrated.runUsage = parseUsageJson<RunUsageSnapshot>(row.runUsageJson)
  hydrated.provider = typeof row.provider === 'string' ? row.provider : null
  hydrated.model = typeof row.model === 'string' ? row.model : null
  hydrated.effortLevel = typeof row.effortLevel === 'string' ? row.effortLevel as ChatEffortLevel : null
  hydrated.usageCapturedAt = typeof row.usageCapturedAt === 'string' ? row.usageCapturedAt : null
  delete hydrated.responseUsageJson
  delete hydrated.runUsageJson
  return hydrated
}

export function registerChatHandlers(db: Database.Database) {
  console.log('[chat-handlers] Registering chat IPC handlers')

  // Chat completion via ProviderRouter (for subscription providers in context mode)
  ipcMain.handle('chat:providerCompletion', async (_event, payload: {
    messages: Array<{ role: string; content: unknown }>
    model: string
    maxTokens?: number
    effortLevel?: ChatEffortLevel
  }) => {
    const config = readConfig()
    const request: ChatCompletionRequest = {
      model: payload.model,
      messages: payload.messages as ChatCompletionRequest['messages'],
      maxTokens: payload.maxTokens ?? 4096,
      effortLevel: payload.effortLevel,
    }
    const response = await providerRouter.chatCompletion(config, request)
    return {
      content: response.choices?.[0]?.message?.content ?? '',
      usage: response.usage,
      providerId: response.providerId,
      providerName: response.providerName,
    }
  })

  // Streaming chat completion for subscription providers (sends chunks via IPC events)
  ipcMain.handle('chat:streamProviderCompletion', async (event, payload: {
    messages: Array<{ role: string; content: unknown }>
    model: string
    maxTokens?: number
    effortLevel?: ChatEffortLevel
  }) => {
    const config = readConfig()
    const request: ChatCompletionRequest = {
      model: payload.model,
      messages: payload.messages as ChatCompletionRequest['messages'],
      maxTokens: payload.maxTokens ?? 4096,
      effortLevel: payload.effortLevel,
    }

    // Try streaming if the provider supports it (Claude subscription)
    const provider = providerRouter.resolveProviderForModel(config, request.model)
    if (provider instanceof ClaudeSubscriptionAdapter) {
      try {
        const result = await provider.streamChatCompletion(request, (chunk) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:streamChunk', chunk)
          }
        })
        return {
          content: result.content,
          usage: result.usage,
          providerId: provider.id,
          providerName: provider.name,
        }
      } catch (err) {
        // Fallback to non-streaming on error
        console.warn('[chat:streamProviderCompletion] Streaming failed, falling back:', err)
      }
    }

    // Fallback: non-streaming
    const response = await providerRouter.chatCompletion(config, request)
    return {
      content: response.choices?.[0]?.message?.content ?? '',
      usage: response.usage,
      providerId: response.providerId,
      providerName: response.providerName,
    }
  })

  ipcMain.handle('chat:listConversations', (_e, projectId: string) => {
    try {
      return db
        .prepare('SELECT * FROM chatConversations WHERE projectId = ? ORDER BY updatedAt DESC')
        .all(projectId)
    } catch (err) {
      console.error('[chat:listConversations] Error:', err)
      return []
    }
  })

  ipcMain.handle('chat:getConversation', (_e, id: number) => {
    return db
      .prepare('SELECT * FROM chatConversations WHERE id = ?')
      .get(id)
  })

  ipcMain.handle('chat:createConversation', (_e, data: { projectId: string; title: string }) => {
    console.log('[chat:createConversation] Creating conversation:', data)
    try {
      const now = new Date().toISOString()
      const result = db
        .prepare('INSERT INTO chatConversations (projectId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
        .run(data.projectId, data.title, now, now)
      const row = db
        .prepare('SELECT * FROM chatConversations WHERE id = ?')
        .get(result.lastInsertRowid)
      console.log('[chat:createConversation] Created:', row)
      return row
    } catch (err) {
      console.error('[chat:createConversation] Error:', err)
      throw err
    }
  })

  ipcMain.handle('chat:listMessages', (_e, conversationId: number) => {
    const messages = db
      .prepare('SELECT * FROM chatMessages WHERE conversationId = ? ORDER BY createdAt ASC')
      .all(conversationId) as Array<Record<string, unknown>>

    if (messages.length === 0) return messages

    // Enrich messages with their attachments
    const messageIds = messages.map((m) => m.id as number)
    const placeholders = messageIds.map(() => '?').join(',')
    const attachments = db
      .prepare(`SELECT * FROM chatMessageAttachments WHERE messageId IN (${placeholders}) ORDER BY id ASC`)
      .all(...messageIds) as Array<Record<string, unknown>>

    // Group attachments by messageId
    const attachmentsByMessageId = new Map<number, Array<Record<string, unknown>>>()
    for (const att of attachments) {
      const msgId = att.messageId as number
      if (!attachmentsByMessageId.has(msgId)) {
        attachmentsByMessageId.set(msgId, [])
      }
      attachmentsByMessageId.get(msgId)!.push(att)
    }

    // Attach to each message
    for (const msg of messages) {
      const msgAttachments = attachmentsByMessageId.get(msg.id as number)
      if (msgAttachments && msgAttachments.length > 0) {
        msg.attachments = msgAttachments
      }
    }

    return messages.map(hydrateChatMessage)
  })

  ipcMain.handle('chat:sendMessage', (_e, data: {
    conversationId: number
    role: string
    content: string
    attachments?: ChatAttachment[]
    responseUsage?: TokenUsage | null
    runUsage?: RunUsageSnapshot | null
    provider?: string | null
    model?: string | null
    effortLevel?: ChatEffortLevel | null
    usageCapturedAt?: string | null
  }) => {
    console.log('[chat:sendMessage] Saving message for conversation:', data.conversationId, 'role:', data.role, 'attachments:', data.attachments?.length ?? 0)
    try {
      const now = new Date().toISOString()
      const result = db
        .prepare(`
          INSERT INTO chatMessages (
            conversationId,
            role,
            content,
            createdAt,
            responseUsageJson,
            runUsageJson,
            provider,
            model,
            effortLevel,
            usageCapturedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          data.conversationId,
          data.role,
          data.content,
          now,
          data.responseUsage ? JSON.stringify(data.responseUsage) : null,
          data.runUsage ? JSON.stringify(data.runUsage) : null,
          data.provider ?? null,
          data.model ?? null,
          data.effortLevel ?? null,
          data.usageCapturedAt ?? null,
        )

      const messageId = result.lastInsertRowid as number

      // Persist attachments if provided
      if (data.attachments && data.attachments.length > 0) {
        const insertAtt = db.prepare(
          'INSERT INTO chatMessageAttachments (messageId, attachmentId, kind, name, mimeType, dataUrl, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        for (const att of data.attachments) {
          insertAtt.run(messageId, att.id, att.kind, att.name, att.mimeType, att.dataUrl, att.source ?? null, now)
        }
      }

      // Update conversation updatedAt
      db.prepare('UPDATE chatConversations SET updatedAt = ? WHERE id = ?')
        .run(now, data.conversationId)

      // Return message enriched with attachments
      const msg = db
        .prepare('SELECT * FROM chatMessages WHERE id = ?')
        .get(messageId) as Record<string, unknown>

      if (data.attachments && data.attachments.length > 0) {
        msg.attachments = db
          .prepare('SELECT * FROM chatMessageAttachments WHERE messageId = ? ORDER BY id ASC')
          .all(messageId)
      }

      return hydrateChatMessage(msg)
    } catch (err) {
      console.error('[chat:sendMessage] Error:', err)
      throw err
    }
  })

  ipcMain.handle('chat:deleteConversation', (_e, id: number) => {
    db.prepare('DELETE FROM chatMessages WHERE conversationId = ?').run(id)
    const result = db.prepare('DELETE FROM chatConversations WHERE id = ?').run(id)
    return result.changes > 0
  })

  // Insert a browser command into the browserCommands table for the BrowserView to execute
  ipcMain.handle('chat:browserCommand', (_e, tool: string, argsJSON: string) => {
    const now = new Date().toISOString()
    const result = db
      .prepare('INSERT INTO browserCommands (tool, args, status, createdAt) VALUES (?, ?, ?, ?)')
      .run(tool, argsJSON, 'pending', now)
    return { id: result.lastInsertRowid }
  })
}
