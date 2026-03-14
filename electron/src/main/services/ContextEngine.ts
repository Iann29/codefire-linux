import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { Worker } from 'worker_threads'

import type { IndexProgress } from '@shared/models'
import { ChunkDAO } from '@main/database/dao/ChunkDAO'
import { IndexDAO } from '@main/database/dao/IndexDAO'
import { getDatabasePath } from '@main/database/paths'
import { detectLanguage, chunkFile } from '@main/services/CodeChunker'
import {
  hashContent,
  shouldIndexFile,
} from '@main/services/indexing-constants'
import type { EmbeddingClient } from './EmbeddingClient'
import { float32ArrayToBlob } from '@main/database/search/vector-search'

const EMBEDDING_BATCH_SIZE = 50

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

interface ProjectMutationHooks {
  onProjectMutated?: (projectId: string) => void
}

interface ReindexResult {
  success: boolean
  skipped?: boolean
  reason?: 'already-indexing' | 'already-queued'
}

interface WorkerHandle {
  worker: Worker
  cancelFlag: Int32Array
}

type WorkerMessage =
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'complete'; progress: IndexProgress; totalChunks: number }
  | { type: 'cancelled'; progress: IndexProgress }
  | { type: 'error'; error: string }

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createAbortError(): Error {
  const error = new Error('Indexing cancelled')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildEmptyProgress(projectId: string): IndexProgress {
  return {
    projectId,
    phase: 'enumerating',
    filesTotal: 0,
    filesProcessed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    embeddingsTotal: 0,
    embeddingsGenerated: 0,
    embeddingsFailed: 0,
    elapsedMs: 0,
  }
}

export class ContextEngine {
  private db: Database.Database
  private chunkDAO: ChunkDAO
  private indexDAO: IndexDAO
  private embeddingClient: EmbeddingClient | null
  private dbPath: string

  private activeOperations = new Map<string, Promise<void>>()
  private abortControllers = new Map<string, Set<AbortController>>()
  private requestWaiters = new Map<number, Deferred<void>>()
  private workerHandles = new Map<string, WorkerHandle>()
  private queueRunning = false
  private progressCallback?: (progress: IndexProgress) => void
  private hooks: ProjectMutationHooks

  constructor(
    db: Database.Database,
    embeddingClient?: EmbeddingClient,
    hooks?: ProjectMutationHooks
  ) {
    this.db = db
    this.chunkDAO = new ChunkDAO(db)
    this.indexDAO = new IndexDAO(db)
    this.embeddingClient = embeddingClient ?? null
    this.hooks = hooks ?? {}
    this.dbPath = ((db as Database.Database & { name?: string }).name) ?? getDatabasePath()

    this.indexDAO.clearRequests()
  }

  onProgress(callback: (progress: IndexProgress) => void): void {
    this.progressCallback = callback
  }

  isIndexing(projectId: string): boolean {
    return this.activeOperations.has(projectId) || this.indexDAO.hasQueuedRequest(projectId)
  }

  async requestProjectIndex(
    projectId: string,
    projectPath: string,
    options?: { waitForCompletion?: boolean }
  ): Promise<ReindexResult> {
    const waitForCompletion = options?.waitForCompletion ?? true

    if (this.activeOperations.has(projectId)) {
      return { success: true, skipped: true, reason: 'already-indexing' }
    }

    if (this.indexDAO.hasQueuedRequest(projectId)) {
      return { success: true, skipped: true, reason: 'already-queued' }
    }

    this.hooks.onProjectMutated?.(projectId)
    this.indexDAO.updateState(projectId, {
      status: 'indexing',
      lastError: null,
    })

    const requestId = this.indexDAO.createRequest(projectId, projectPath)
    const waiter = createDeferred<void>()
    this.requestWaiters.set(requestId, waiter)

    void this.processQueue()

    if (!waitForCompletion) {
      return { success: true }
    }

    await waiter.promise
    return { success: true }
  }

  async indexFile(
    projectId: string,
    projectPath: string,
    relativePath: string
  ): Promise<void> {
    await this.indexFiles(projectId, projectPath, [relativePath])
  }

  async indexFiles(
    projectId: string,
    projectPath: string,
    relativePaths: string[]
  ): Promise<void> {
    const uniqueRelativePaths = [...new Set(relativePaths.filter(Boolean))]
    if (uniqueRelativePaths.length === 0) return

    const controller = new AbortController()
    const startTime = Date.now()
    const progress = buildEmptyProgress(projectId)
    progress.phase = 'indexing'
    progress.filesTotal = uniqueRelativePaths.length

    this.registerAbortController(projectId, controller)

    try {
      await this.withProjectLock(projectId, async () => {
        this.hooks.onProjectMutated?.(projectId)
        this.indexDAO.updateState(projectId, {
          status: 'indexing',
          lastError: null,
        })
        this.emitProgress(progress)

        for (const relativePath of uniqueRelativePaths) {
          this.throwIfAborted(controller.signal)

          const result = this.indexRelativeFile(
            projectId,
            projectPath,
            relativePath
          )

          progress.filesProcessed += 1
          if (result.skipped) {
            progress.filesSkipped += 1
          }
          progress.chunksCreated += result.chunksCreated
          progress.elapsedMs = Date.now() - startTime

          if (progress.filesProcessed > 0) {
            const avgMsPerFile = progress.elapsedMs / progress.filesProcessed
            progress.estimatedRemainingMs = Math.max(
              0,
              Math.round(
                avgMsPerFile * (progress.filesTotal - progress.filesProcessed)
              )
            )
          }

          this.emitProgress(progress)
        }

        progress.phase = 'embedding'
        progress.elapsedMs = Date.now() - startTime
        progress.embeddingsTotal = this.countEmbeddingsToGenerate(projectId)
        progress.embeddingsGenerated = 0
        progress.embeddingsFailed = 0
        progress.estimatedRemainingMs = undefined
        this.emitProgress(progress)

        await this.generateEmbeddings(
          projectId,
          controller.signal,
          (generated, failed) => {
            progress.embeddingsGenerated = generated
            progress.embeddingsFailed = failed
            progress.elapsedMs = Date.now() - startTime
            this.emitProgress(progress)
          }
        )

        this.throwIfAborted(controller.signal)

        progress.phase = 'finalizing'
        progress.elapsedMs = Date.now() - startTime
        progress.estimatedRemainingMs = 0
        this.emitProgress(progress)

        const totalChunks = this.chunkDAO.countByProject(projectId)
        this.indexDAO.updateState(projectId, {
          status: 'ready',
          totalChunks,
          lastError: null,
          embeddingModel: this.embeddingClient?.getModel() ?? null,
        })
      }, controller.signal)
    } catch (error: unknown) {
      if (isAbortError(error)) {
        this.indexDAO.updateState(projectId, {
          status: 'idle',
          lastError: null,
        })
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      this.indexDAO.updateState(projectId, {
        status: 'error',
        lastError: message,
      })
      throw error
    } finally {
      this.unregisterAbortController(projectId, controller)
      this.hooks.onProjectMutated?.(projectId)
    }
  }

  async removeFile(
    projectId: string,
    relativePath: string
  ): Promise<void> {
    const controller = new AbortController()
    this.registerAbortController(projectId, controller)

    try {
      await this.withProjectLock(projectId, async () => {
        this.hooks.onProjectMutated?.(projectId)
        this.removeFileInternal(projectId, relativePath)
        this.indexDAO.updateState(projectId, {
          totalChunks: this.chunkDAO.countByProject(projectId),
        })
      }, controller.signal)
    } finally {
      this.unregisterAbortController(projectId, controller)
      this.hooks.onProjectMutated?.(projectId)
    }
  }

  cancelIndexing(projectId: string): void {
    const pendingIds = this.indexDAO.deletePendingRequests(projectId)
    const abortError = createAbortError()

    for (const requestId of pendingIds) {
      this.finishRequest(requestId, abortError)
    }

    const controllers = this.abortControllers.get(projectId)
    if (controllers) {
      for (const controller of controllers) {
        controller.abort()
      }
      this.abortControllers.delete(projectId)
    }

    const workerHandle = this.workerHandles.get(projectId)
    if (workerHandle) {
      Atomics.store(workerHandle.cancelFlag, 0, 1)
    }

    if (!this.activeOperations.has(projectId) && pendingIds.length > 0) {
      this.indexDAO.updateState(projectId, {
        status: 'idle',
        lastError: null,
      })
    }
  }

  cancelAll(): void {
    const abortError = createAbortError()

    for (const [projectId, controllers] of this.abortControllers) {
      for (const controller of controllers) {
        controller.abort()
      }
      this.abortControllers.delete(projectId)
    }

    for (const workerHandle of this.workerHandles.values()) {
      Atomics.store(workerHandle.cancelFlag, 0, 1)
    }

    this.indexDAO.clearRequests()

    for (const [requestId] of this.requestWaiters) {
      this.finishRequest(requestId, abortError)
    }
  }

  async waitForIdle(projectId: string): Promise<void> {
    const active = this.activeOperations.get(projectId)
    if (active) {
      await active.catch(() => {})
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queueRunning) return
    this.queueRunning = true

    try {
      while (true) {
        const request = this.indexDAO.getPendingRequest()
        if (!request) return

        this.indexDAO.markProcessing(request.id)

        try {
          await this.runQueuedProjectIndex(request.projectId, request.projectPath)
          this.finishRequest(request.id)
        } catch (error) {
          this.finishRequest(request.id, error)
        } finally {
          this.indexDAO.markCompleted(request.id)
        }
      }
    } finally {
      this.queueRunning = false
    }
  }

  private async runQueuedProjectIndex(
    projectId: string,
    projectPath: string
  ): Promise<void> {
    const controller = new AbortController()
    const startTime = Date.now()

    this.registerAbortController(projectId, controller)

    try {
      await this.withProjectLock(projectId, async () => {
        this.hooks.onProjectMutated?.(projectId)
        this.indexDAO.updateState(projectId, {
          status: 'indexing',
          lastError: null,
        })

        const progress = await this.runWorkerIndex(projectId, projectPath, controller.signal)
        this.throwIfAborted(controller.signal)

        progress.phase = 'embedding'
        progress.elapsedMs = Date.now() - startTime
        progress.embeddingsTotal = this.countEmbeddingsToGenerate(projectId)
        progress.embeddingsGenerated = 0
        progress.embeddingsFailed = 0
        progress.estimatedRemainingMs = undefined
        this.emitProgress(progress)

        await this.generateEmbeddings(
          projectId,
          controller.signal,
          (generated, failed) => {
            progress.embeddingsGenerated = generated
            progress.embeddingsFailed = failed
            progress.elapsedMs = Date.now() - startTime
            this.emitProgress(progress)
          }
        )

        this.throwIfAborted(controller.signal)

        progress.phase = 'finalizing'
        progress.elapsedMs = Date.now() - startTime
        progress.estimatedRemainingMs = 0
        this.emitProgress(progress)

        const totalChunks = this.chunkDAO.countByProject(projectId)
        this.indexDAO.updateState(projectId, {
          status: 'ready',
          lastFullIndexAt: new Date().toISOString(),
          totalChunks,
          lastError: null,
          embeddingModel: this.embeddingClient?.getModel() ?? null,
        })
      }, controller.signal)
    } catch (error: unknown) {
      if (isAbortError(error)) {
        this.indexDAO.updateState(projectId, {
          status: 'idle',
          lastError: null,
        })
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)
      this.indexDAO.updateState(projectId, {
        status: 'error',
        lastError: message,
      })
      throw error
    } finally {
      this.unregisterAbortController(projectId, controller)
      this.hooks.onProjectMutated?.(projectId)
    }
  }

  private async runWorkerIndex(
    projectId: string,
    projectPath: string,
    signal: AbortSignal
  ): Promise<IndexProgress> {
    const workerPath = path.join(__dirname, 'workers', 'index-worker.js')
    const cancelBuffer = new SharedArrayBuffer(4)
    const cancelFlag = new Int32Array(cancelBuffer)
    const worker = new Worker(workerPath, {
      workerData: {
        dbPath: this.dbPath,
        cancelBuffer,
      },
    })

    this.workerHandles.set(projectId, { worker, cancelFlag })

    return await new Promise<IndexProgress>((resolve, reject) => {
      let settled = false

      const finalize = (callback: () => void) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', handleAbort)
        this.workerHandles.delete(projectId)
        callback()
        void worker.terminate().catch(() => {})
      }

      const handleAbort = () => {
        Atomics.store(cancelFlag, 0, 1)
      }

      const handleMessage = (message: WorkerMessage) => {
        switch (message.type) {
          case 'progress':
            this.emitProgress(message.progress)
            return
          case 'complete':
            finalize(() => resolve(message.progress))
            return
          case 'cancelled':
            finalize(() => reject(createAbortError()))
            return
          case 'error':
            finalize(() => reject(new Error(message.error)))
        }
      }

      worker.on('message', handleMessage)
      worker.once('error', (error) => {
        finalize(() => reject(error))
      })
      worker.once('exit', (code) => {
        if (settled) return

        this.workerHandles.delete(projectId)
        signal.removeEventListener('abort', handleAbort)

        if (signal.aborted) {
          reject(createAbortError())
          return
        }

        if (code !== 0) {
          reject(new Error(`Index worker exited with code ${code}`))
          return
        }

        resolve(buildEmptyProgress(projectId))
      })

      signal.addEventListener('abort', handleAbort, { once: true })
      worker.postMessage({
        type: 'indexProject',
        projectId,
        projectPath,
      })
    })
  }

  private async withProjectLock<T>(
    projectId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const previous = this.activeOperations.get(projectId) ?? Promise.resolve()

    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })

    const chain = previous.catch(() => undefined).then(() => current)
    this.activeOperations.set(projectId, chain)

    try {
      await this.waitForPrevious(previous, signal)
      this.throwIfAborted(signal)
      return await operation()
    } finally {
      release()
      if (this.activeOperations.get(projectId) === chain) {
        this.activeOperations.delete(projectId)
      }
    }
  }

  private async waitForPrevious(
    promise: Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    if (!signal) {
      await promise.catch(() => undefined)
      return
    }

    if (signal.aborted) {
      throw createAbortError()
    }

    await Promise.race([
      promise.catch(() => undefined),
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(createAbortError())
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  }

  private registerAbortController(
    projectId: string,
    controller: AbortController
  ): void {
    const controllers = this.abortControllers.get(projectId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.abortControllers.set(projectId, controllers)
  }

  private unregisterAbortController(
    projectId: string,
    controller: AbortController
  ): void {
    const controllers = this.abortControllers.get(projectId)
    if (!controllers) return

    controllers.delete(controller)
    if (controllers.size === 0) {
      this.abortControllers.delete(projectId)
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw createAbortError()
    }
  }

  private emitProgress(progress: IndexProgress): void {
    this.progressCallback?.({ ...progress })
  }

  private finishRequest(requestId: number, error?: unknown): void {
    const waiter = this.requestWaiters.get(requestId)
    if (!waiter) return

    this.requestWaiters.delete(requestId)

    if (error !== undefined) {
      waiter.reject(error)
      return
    }

    waiter.resolve(undefined)
  }

  private indexRelativeFile(
    projectId: string,
    projectPath: string,
    relativePath: string
  ): { skipped: boolean; chunksCreated: number } {
    const absolutePath = path.join(projectPath, relativePath)

    if (!fs.existsSync(absolutePath) || !shouldIndexFile(absolutePath)) {
      this.removeFileInternal(projectId, relativePath)
      return { skipped: false, chunksCreated: 0 }
    }

    let content: string
    try {
      content = fs.readFileSync(absolutePath, 'utf-8')
    } catch {
      this.removeFileInternal(projectId, relativePath)
      return { skipped: false, chunksCreated: 0 }
    }

    const contentHash = hashContent(content)
    const existing = this.indexDAO.getFileByPath(projectId, relativePath)

    if (existing && existing.contentHash === contentHash) {
      return { skipped: true, chunksCreated: 0 }
    }

    if (existing) {
      this.chunkDAO.deleteByFile(existing.id)
    }

    const language = detectLanguage(relativePath)
    const chunks = chunkFile(content, language)
    const indexedFile = this.indexDAO.upsertFile({
      projectId,
      relativePath,
      contentHash,
      language,
    })

    for (const chunk of chunks) {
      this.chunkDAO.insert({
        id: randomUUID(),
        fileId: indexedFile.id,
        projectId,
        chunkType: chunk.chunkType,
        symbolName: chunk.symbolName,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: null,
        embeddingModel: null,
      })
    }

    return { skipped: false, chunksCreated: chunks.length }
  }

  private removeFileInternal(projectId: string, relativePath: string): void {
    const existing = this.indexDAO.getFileByPath(projectId, relativePath)
    if (!existing) return

    this.chunkDAO.deleteByFile(existing.id)
    this.indexDAO.deleteFile(existing.id)
  }

  private countEmbeddingsToGenerate(projectId: string): number {
    if (!this.embeddingClient?.hasApiKey()) {
      return 0
    }

    const currentModel = this.embeddingClient.getModel()
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM codeChunks
         WHERE projectId = ?
           AND (embedding IS NULL OR embeddingModel IS NULL OR embeddingModel != ?)`
      )
      .get(projectId, currentModel) as { count: number }

    return row.count
  }

  private async generateEmbeddings(
    projectId: string,
    signal?: AbortSignal,
    onProgress?: (generated: number, failed: number) => void
  ): Promise<void> {
    if (!this.embeddingClient?.hasApiKey()) return

    const currentModel = this.embeddingClient.getModel()
    const chunks = this.db
      .prepare(
        `SELECT id, content
         FROM codeChunks
         WHERE projectId = ?
           AND (embedding IS NULL OR embeddingModel IS NULL OR embeddingModel != ?)`
      )
      .all(projectId, currentModel) as Array<{ id: string; content: string }>

    if (chunks.length === 0) {
      this.indexDAO.updateState(projectId, { embeddingModel: currentModel })
      return
    }

    let successCount = 0
    let failCount = 0
    let consecutiveFailures = 0

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      this.throwIfAborted(signal)

      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)

      try {
        const embeddings = await this.embeddingClient.getEmbeddings(
          batch.map((chunk) => chunk.content),
          'document'
        )

        this.throwIfAborted(signal)

        for (let j = 0; j < batch.length; j++) {
          this.chunkDAO.updateEmbedding(
            batch[j].id,
            float32ArrayToBlob(embeddings[j]),
            currentModel
          )
        }

        successCount += batch.length
        consecutiveFailures = 0
        onProgress?.(successCount, failCount)
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }

        failCount += batch.length
        consecutiveFailures += 1
        onProgress?.(successCount, failCount)

        console.error(
          `[ContextEngine] Embedding batch failed (${consecutiveFailures} consecutive):`,
          error
        )

        if (consecutiveFailures >= 3) {
          console.warn(
            `[ContextEngine] Stopping embeddings after ${consecutiveFailures} consecutive failures for ${projectId}.`
          )
          break
        }

        await delay(Math.min(1000 * Math.pow(2, consecutiveFailures), 30_000))
      }
    }

    this.indexDAO.updateState(projectId, { embeddingModel: currentModel })

    if (failCount > 0) {
      console.warn(
        `[ContextEngine] Embedding generation: ${successCount} succeeded, ${failCount} failed (project ${projectId}).`
      )
    }
  }
}
