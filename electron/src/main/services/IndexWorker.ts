import Database from 'better-sqlite3'
import { parentPort, workerData } from 'worker_threads'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'

import type { IndexProgress } from '@shared/models'
import { ChunkDAO } from '@main/database/dao/ChunkDAO'
import { IndexDAO } from '@main/database/dao/IndexDAO'
import {
  chunkFile,
  chunkGitHistory,
  detectLanguage,
} from '@main/services/CodeChunker'
import {
  enumerateFiles,
  hashContent,
  shouldIndexFile,
} from '@main/services/indexing-constants'

const execFileAsync = promisify(execFile)

interface WorkerInitData {
  dbPath: string
  cancelBuffer: SharedArrayBuffer
}

interface IndexProjectCommand {
  type: 'indexProject'
  projectId: string
  projectPath: string
}

type WorkerCommand = IndexProjectCommand

type WorkerMessage =
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'complete'; progress: IndexProgress; totalChunks: number }
  | { type: 'cancelled'; progress: IndexProgress }
  | { type: 'error'; error: string }

const { dbPath, cancelBuffer } = workerData as WorkerInitData
const cancelFlag = new Int32Array(cancelBuffer)
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')

const chunkDAO = new ChunkDAO(db)
const indexDAO = new IndexDAO(db)

function isCancelled(): boolean {
  return Atomics.load(cancelFlag, 0) === 1
}

function emit(message: WorkerMessage): void {
  parentPort?.postMessage(message)
}

function updateProgress(
  progress: IndexProgress,
  patch: Partial<IndexProgress>
): IndexProgress {
  Object.assign(progress, patch)
  return { ...progress }
}

async function indexGitHistory(projectId: string, projectPath: string): Promise<void> {
  const gitFileId = `__git_history__:${projectId}`
  chunkDAO.deleteByFile(gitFileId)

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectPath, 'log', '--oneline', '-n', '200'],
      { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }
    )

    if (!stdout.trim()) return

    const chunks = chunkGitHistory(stdout)
    for (const chunk of chunks) {
      chunkDAO.insert({
        id: randomUUID(),
        fileId: gitFileId,
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
  } catch {
    // Ignore missing git repositories.
  }
}

async function handleIndexProject(
  projectId: string,
  projectPath: string
): Promise<void> {
  const startedAt = Date.now()
  const progress: IndexProgress = {
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

  emit({ type: 'progress', progress: { ...progress } })

  const absolutePaths = enumerateFiles(projectPath)
  const relativePaths = absolutePaths.map((filePath) =>
    path.relative(projectPath, filePath)
  )

  emit({
    type: 'progress',
    progress: updateProgress(progress, {
      filesTotal: absolutePaths.length,
      elapsedMs: Date.now() - startedAt,
    }),
  })

  for (let i = 0; i < absolutePaths.length; i++) {
    if (isCancelled()) {
      emit({
        type: 'cancelled',
        progress: updateProgress(progress, {
          elapsedMs: Date.now() - startedAt,
        }),
      })
      return
    }

    const absolutePath = absolutePaths[i]
    const relativePath = relativePaths[i]

    if (!shouldIndexFile(absolutePath)) {
      progress.filesProcessed += 1
      continue
    }

    let content: string
    try {
      content = fs.readFileSync(absolutePath, 'utf-8')
    } catch {
      progress.filesProcessed += 1
      continue
    }

    const contentHash = hashContent(content)
    const existing = indexDAO.getFileByPath(projectId, relativePath)

    if (existing && existing.contentHash === contentHash) {
      progress.filesProcessed += 1
      progress.filesSkipped += 1
    } else {
      if (existing) {
        chunkDAO.deleteByFile(existing.id)
      }

      const language = detectLanguage(relativePath)
      const chunks = chunkFile(content, language)
      const indexedFile = indexDAO.upsertFile({
        projectId,
        relativePath,
        contentHash,
        language,
      })

      for (const chunk of chunks) {
        chunkDAO.insert({
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

      progress.filesProcessed += 1
      progress.chunksCreated += chunks.length
    }

    if (
      progress.filesProcessed % 20 === 0 ||
      progress.filesProcessed === progress.filesTotal
    ) {
      const elapsedMs = Date.now() - startedAt
      const avgMsPerFile = progress.filesProcessed > 0
        ? elapsedMs / progress.filesProcessed
        : 0

      emit({
        type: 'progress',
        progress: updateProgress(progress, {
          phase: 'indexing',
          elapsedMs,
          estimatedRemainingMs: Math.max(
            0,
            Math.round(avgMsPerFile * (progress.filesTotal - progress.filesProcessed))
          ),
        }),
      })
    }
  }

  indexDAO.deleteStaleFiles(projectId, relativePaths)

  if (isCancelled()) {
    emit({
      type: 'cancelled',
      progress: updateProgress(progress, {
        elapsedMs: Date.now() - startedAt,
      }),
    })
    return
  }

  emit({
    type: 'progress',
    progress: updateProgress(progress, {
      phase: 'git-history',
      elapsedMs: Date.now() - startedAt,
      estimatedRemainingMs: undefined,
    }),
  })

  await indexGitHistory(projectId, projectPath)

  if (isCancelled()) {
    emit({
      type: 'cancelled',
      progress: updateProgress(progress, {
        elapsedMs: Date.now() - startedAt,
      }),
    })
    return
  }

  emit({
    type: 'complete',
    progress: updateProgress(progress, {
      elapsedMs: Date.now() - startedAt,
    }),
    totalChunks: chunkDAO.countByProject(projectId),
  })
}

parentPort?.on('message', (command: WorkerCommand) => {
  if (command.type !== 'indexProject') return

  void handleIndexProject(command.projectId, command.projectPath).catch((error) => {
    emit({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  })
})
