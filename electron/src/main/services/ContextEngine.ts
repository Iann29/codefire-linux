import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { ChunkDAO } from '@main/database/dao/ChunkDAO'
import { IndexDAO } from '@main/database/dao/IndexDAO'
import {
  chunkFile,
  chunkGitHistory,
  detectLanguage,
} from '@main/services/CodeChunker'
import type { EmbeddingClient } from './EmbeddingClient'
import { float32ArrayToBlob } from '@main/database/search/vector-search'

const execFileAsync = promisify(execFile)

// ─── Skip Rules ──────────────────────────────────────────────────────────────

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.build',
  'build',
  '.dart_tool',
  '__pycache__',
  '.next',
  'dist',
  'dist-electron',
  'release',
  'out',
  '.output',
  '.git',
  '.gradle',
  'Pods',
  '.pub-cache',
  '.pub',
  '.swiftpm',
  'DerivedData',
  '.expo',
  'coverage',
  'vendor',
  'target',
  '.cache',
  '.vite',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  '.angular',
  '.nuxt',
  '.docusaurus',
  '.storybook-static',
  'storybook-static',
  '.temp',
  'tmp',
])

const SKIP_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'tiff', 'avif',
  // Fonts
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  // Archives & packages
  'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z',
  'dmg', 'deb', 'rpm', 'AppImage', 'snap', 'flatpak',
  'asar', 'nupkg', 'msi', 'exe',
  // Media
  'mp3', 'mp4', 'wav', 'mov', 'avi', 'mkv', 'flac', 'ogg', 'webm',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Lock & dependency files
  'lock', 'sum',
  // Binary & compiled
  'so', 'dylib', 'dll', 'o', 'a', 'lib', 'pyc', 'pyo', 'class', 'wasm',
  // Data & resource blobs
  'pak', 'dat', 'bin', 'db', 'sqlite', 'sqlite3',
  // Source maps & minified bundles (low-value for indexing)
  'map',
  // Misc binary
  'DS_Store',
])

// Max file size to index (512 KB). Anything larger is likely a bundle, binary, or generated file.
const MAX_FILE_SIZE = 512 * 1024

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRECTORIES.has(dirName)
}

function shouldSkipFile(filePath: string): boolean {
  const dotIdx = filePath.lastIndexOf('.')
  if (dotIdx < 0) return false
  const ext = filePath.slice(dotIdx + 1).toLowerCase()
  return SKIP_EXTENSIONS.has(ext)
}

function isFileTooLarge(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    return stat.size > MAX_FILE_SIZE
  } catch {
    return false
  }
}

/**
 * Recursively enumerate all files in a directory, skipping excluded dirs/extensions.
 */
function enumerateFiles(dirPath: string): string[] {
  const results: string[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        results.push(...enumerateFiles(path.join(dirPath, entry.name)))
      }
    } else if (entry.isFile()) {
      const fullPath = path.join(dirPath, entry.name)
      if (!shouldSkipFile(fullPath) && !isFileTooLarge(fullPath)) {
        results.push(fullPath)
      }
    }
  }

  return results
}

// ─── Context Engine ──────────────────────────────────────────────────────────

/**
 * Orchestrates code indexing for a project.
 *
 * Handles full-project indexing, single-file indexing, and file removal.
 * Uses CodeChunker for semantic chunking and IndexDAO/ChunkDAO for persistence.
 */
/** Max chunks per embedding batch (avoid oversized API requests). */
const EMBEDDING_BATCH_SIZE = 50

export class ContextEngine {
  private db: Database.Database
  private chunkDAO: ChunkDAO
  private indexDAO: IndexDAO
  private embeddingClient: EmbeddingClient | null

  constructor(db: Database.Database, embeddingClient?: EmbeddingClient) {
    this.db = db
    this.chunkDAO = new ChunkDAO(db)
    this.indexDAO = new IndexDAO(db)
    this.embeddingClient = embeddingClient ?? null
  }

  /**
   * Index an entire project directory.
   *
   * 1. Set indexState to "indexing"
   * 2. Enumerate all files (skip excluded directories/extensions)
   * 3. For each file:
   *    - Compute SHA256 hash
   *    - Check if hash matches existing IndexedFile
   *    - If unchanged → skip
   *    - If changed → delete old chunks, re-chunk, insert new chunks
   * 4. Delete stale IndexedFile records for files no longer in project
   * 5. Chunk git history (last 200 commits)
   * 6. Set indexState to "ready" with chunk count
   * 7. On error: set indexState to "error" with message
   */
  async indexProject(
    projectId: string,
    projectPath: string
  ): Promise<void> {
    try {
      // Step 1: Set state to indexing
      this.indexDAO.updateState(projectId, {
        status: 'indexing',
        lastError: null,
      })

      // Step 2: Enumerate files
      const absolutePaths = enumerateFiles(projectPath)
      const relativePaths = absolutePaths.map((p) =>
        path.relative(projectPath, p)
      )

      // Step 3: Process each file
      for (let i = 0; i < absolutePaths.length; i++) {
        const absPath = absolutePaths[i]
        const relPath = relativePaths[i]

        let content: string
        try {
          content = fs.readFileSync(absPath, 'utf-8')
        } catch {
          continue // Skip unreadable files
        }

        const contentHash = hashContent(content)
        const existing = this.indexDAO.getFileByPath(projectId, relPath)

        // Skip unchanged files
        if (existing && existing.contentHash === contentHash) {
          continue
        }

        // Delete old chunks if file existed before
        if (existing) {
          this.chunkDAO.deleteByFile(existing.id)
        }

        // Detect language and chunk
        const language = detectLanguage(relPath)
        const chunks = chunkFile(content, language)

        // Upsert the indexed file record
        const indexedFile = this.indexDAO.upsertFile({
          projectId,
          relativePath: relPath,
          contentHash,
          language,
        })

        // Insert new chunks
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
          })
        }
      }

      // Step 4: Delete stale files
      this.indexDAO.deleteStaleFiles(projectId, relativePaths)

      // Step 5: Chunk git history
      await this.indexGitHistory(projectId, projectPath)

      // Step 6: Generate embeddings for new chunks (if API key is available)
      await this.generateEmbeddings(projectId)

      // Step 7: Update state to ready
      const totalChunks = this.chunkDAO.countByProject(projectId)
      this.indexDAO.updateState(projectId, {
        status: 'ready',
        lastFullIndexAt: new Date().toISOString(),
        totalChunks,
        lastError: null,
        embeddingModel: this.embeddingClient?.getModel() ?? null,
      })
    } catch (error: unknown) {
      // Step 7: Set error state
      const message =
        error instanceof Error ? error.message : String(error)
      this.indexDAO.updateState(projectId, {
        status: 'error',
        lastError: message,
      })
      throw error
    }
  }

  /**
   * Index (or re-index) a single file.
   */
  async indexFile(
    projectId: string,
    projectPath: string,
    relativePath: string
  ): Promise<void> {
    const absPath = path.join(projectPath, relativePath)

    let content: string
    try {
      content = fs.readFileSync(absPath, 'utf-8')
    } catch {
      // File can't be read — remove it from the index
      await this.removeFile(projectId, relativePath)
      return
    }

    const contentHash = hashContent(content)
    const existing = this.indexDAO.getFileByPath(projectId, relativePath)

    // Skip if unchanged
    if (existing && existing.contentHash === contentHash) return

    // Delete old chunks
    if (existing) {
      this.chunkDAO.deleteByFile(existing.id)
    }

    // Chunk the file
    const language = detectLanguage(relativePath)
    const chunks = chunkFile(content, language)

    // Upsert indexed file record
    const indexedFile = this.indexDAO.upsertFile({
      projectId,
      relativePath,
      contentHash,
      language,
    })

    // Insert new chunks
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
      })
    }

    // Generate embeddings for the new chunks
    await this.generateEmbeddings(projectId)

    // Update total chunk count
    const totalChunks = this.chunkDAO.countByProject(projectId)
    this.indexDAO.updateState(projectId, { totalChunks })
  }

  /**
   * Remove a file from the index.
   */
  async removeFile(
    projectId: string,
    relativePath: string
  ): Promise<void> {
    const existing = this.indexDAO.getFileByPath(projectId, relativePath)
    if (!existing) return

    this.chunkDAO.deleteByFile(existing.id)
    this.indexDAO.deleteFile(existing.id)

    // Update total chunk count
    const totalChunks = this.chunkDAO.countByProject(projectId)
    this.indexDAO.updateState(projectId, { totalChunks })
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Generate embeddings for chunks that don't have one yet.
   * Processes in batches to avoid oversized API requests.
   * Silently skips if no API key is configured.
   *
   * Detects embedding model changes: if the current model differs from
   * the one stored in indexState, all existing embeddings are invalidated
   * (set to NULL) so they get re-generated with the new model.
   */
  private async generateEmbeddings(projectId: string): Promise<void> {
    if (!this.embeddingClient?.hasApiKey()) return

    const currentModel = this.embeddingClient.getModel()

    // ── Model mismatch detection ───────────────────────────────────────────
    // If the embedding model changed since last indexing, old embeddings
    // live in a different vector space and are useless. Null them out.
    const state = this.indexDAO.getState(projectId)
    if (state?.embeddingModel && state.embeddingModel !== currentModel) {
      console.log(
        `[ContextEngine] Embedding model changed: ${state.embeddingModel} → ${currentModel}. Clearing stale embeddings for project ${projectId}.`
      )
      this.db
        .prepare('UPDATE codeChunks SET embedding = NULL WHERE projectId = ? AND embedding IS NOT NULL')
        .run(projectId)
    }

    // ── Find chunks needing embeddings ─────────────────────────────────────
    const chunks = this.db
      .prepare(
        'SELECT id, content FROM codeChunks WHERE projectId = ? AND embedding IS NULL'
      )
      .all(projectId) as { id: string; content: string }[]

    if (chunks.length === 0) {
      // Even if no chunks to embed, record the current model
      this.indexDAO.updateState(projectId, { embeddingModel: currentModel })
      return
    }

    // ── Generate in batches (resilient — continue on error) ────────────────
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)
      try {
        const embeddings = await this.embeddingClient.getEmbeddings(
          batch.map((c) => c.content),
          'document'
        )
        for (let j = 0; j < batch.length; j++) {
          this.chunkDAO.updateEmbedding(
            batch[j].id,
            float32ArrayToBlob(embeddings[j])
          )
        }
        successCount += batch.length
      } catch (err) {
        failCount += batch.length
        console.error(
          `[ContextEngine] Embedding batch ${batchNum} failed (${batch.length} chunks):`,
          err
        )
        // Continue with remaining batches instead of giving up entirely.
        // This handles transient errors (rate limits, timeouts) more gracefully.
      }
    }

    // Record which model was used
    this.indexDAO.updateState(projectId, { embeddingModel: currentModel })

    if (failCount > 0) {
      console.warn(
        `[ContextEngine] Embedding generation: ${successCount} succeeded, ${failCount} failed (project ${projectId}). Failed chunks will be retried on next rebuild.`
      )
    } else {
      console.log(
        `[ContextEngine] Embedded ${successCount} chunks for project ${projectId} using ${currentModel}.`
      )
    }
  }

  /**
   * Index git history as commit chunks.
   * Uses a virtual file with id `__git_history__:{projectId}`.
   */
  private async indexGitHistory(
    projectId: string,
    projectPath: string
  ): Promise<void> {
    const gitFileId = `__git_history__:${projectId}`

    // Delete old git history chunks
    this.chunkDAO.deleteByFile(gitFileId)

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', projectPath, 'log', '--oneline', '-n', '200'],
        { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }
      )

      if (!stdout.trim()) return

      const chunks = chunkGitHistory(stdout)
      for (const chunk of chunks) {
        this.chunkDAO.insert({
          id: randomUUID(),
          fileId: gitFileId,
          projectId,
          chunkType: chunk.chunkType,
          symbolName: chunk.symbolName,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          embedding: null,
        })
      }
    } catch {
      // Not a git repo or git not available — skip silently
    }
  }
}
