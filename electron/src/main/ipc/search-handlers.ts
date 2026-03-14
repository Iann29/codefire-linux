import { ipcMain } from 'electron'
import type { SearchEngine, SearchOptions } from '../services/SearchEngine'
import type { ContextEngine } from '../services/ContextEngine'
import { EmbeddingClient } from '../services/EmbeddingClient'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { IndexDAO } from '../database/dao/IndexDAO'
import Database from 'better-sqlite3'
import type { FileWatcher } from '../services/FileWatcher'

/**
 * Register IPC handlers for search and re-indexing operations.
 */
export function registerSearchHandlers(
  db: Database.Database,
  searchEngine: SearchEngine,
  contextEngine: ContextEngine,
  fileWatcher?: FileWatcher
) {
  const projectDAO = new ProjectDAO(db)
  const indexDAO = new IndexDAO(db)

  ipcMain.handle(
    'search:query',
    async (
      _event,
      projectId: string,
      query: string,
      options?: SearchOptions
    ) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }
      if (!query || typeof query !== 'string') {
        throw new Error('query is required and must be a string')
      }
      return searchEngine.search(projectId, query, options)
    }
  )

  ipcMain.handle(
    'search:reindex',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }

      const project = projectDAO.getById(projectId)
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }

      return contextEngine.requestProjectIndex(projectId, project.path)
    }
  )

  ipcMain.handle(
    'search:getIndexState',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }
      return indexDAO.getState(projectId) ?? null
    }
  )

  ipcMain.handle(
    'search:clearIndex',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }

      contextEngine.cancelIndexing(projectId)
      await contextEngine.waitForIdle(projectId)

      // Delete all indexed files and code chunks for this project
      db.prepare('DELETE FROM codeChunks WHERE projectId = ?').run(projectId)
      db.prepare('DELETE FROM indexedFiles WHERE projectId = ?').run(projectId)
      searchEngine.invalidateProjectCache(projectId)
      indexDAO.updateState(projectId, {
        status: 'idle',
        totalChunks: 0,
        lastFullIndexAt: null,
        lastError: null,
        embeddingModel: null,
      })
      return { success: true }
    }
  )

  ipcMain.handle(
    'search:cancelIndex',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }

      contextEngine.cancelIndexing(projectId)
      await contextEngine.waitForIdle(projectId)
      return { success: true }
    }
  )

  ipcMain.handle(
    'search:ensureWatcher',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }

      if (!fileWatcher) {
        return { success: false, watching: false }
      }

      const project = projectDAO.getById(projectId)
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }

      if (!fileWatcher.isWatching(projectId)) {
        fileWatcher.watch(projectId, project.path)
      }

      return { success: true, watching: fileWatcher.isWatching(projectId) }
    }
  )

  ipcMain.handle(
    'embedding:test',
    async (
      _event,
      config: {
        model: string
        openRouterKey?: string
        googleAiApiKey?: string
      }
    ) => {
      const client = new EmbeddingClient({
        model: config.model,
        openRouterKey: config.openRouterKey,
        googleAiApiKey: config.googleAiApiKey,
      })

      if (!client.hasApiKey()) {
        return { success: false, error: 'No API key configured for this provider.' }
      }

      try {
        const start = Date.now()
        const embedding = await client.getEmbedding('Hello world')
        const latencyMs = Date.now() - start

        return {
          success: true,
          dimensions: embedding.length,
          provider: client.getProvider(),
          latencyMs,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  )
}
