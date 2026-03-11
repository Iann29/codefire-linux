import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import Database from 'better-sqlite3'
import { providerRouter } from './agent-handlers'
import { resolveClaudeProjectDir } from './memory-handlers'
import { readConfig } from '../services/ConfigStore'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { TaskDAO } from '../database/dao/TaskDAO'
import type { ChatCompletionRequest } from '../services/providers/BaseProvider'
import type { ProjectContext } from '@shared/models'
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

// ── Service detection (lightweight inline, mirrors service-handlers.ts) ──────

const STACK_CONFIG_FILES: Array<{ name: string; files: string[] }> = [
  { name: 'Firebase', files: ['firebase.json', '.firebaserc'] },
  { name: 'Supabase', files: ['supabase/config.toml'] },
  { name: 'Convex', files: ['convex.json', 'convex/_generated'] },
  { name: 'Vercel', files: ['vercel.json', '.vercel/project.json'] },
  { name: 'Netlify', files: ['netlify.toml'] },
  { name: 'Docker', files: ['Dockerfile', 'docker-compose.yml', 'compose.yml'] },
  { name: 'Prisma', files: ['prisma/schema.prisma'] },
  { name: 'Drizzle', files: ['drizzle.config.ts', 'drizzle.config.js'] },
  { name: 'Next.js', files: ['next.config.js', 'next.config.ts', 'next.config.mjs'] },
  { name: 'Vite', files: ['vite.config.ts', 'vite.config.js'] },
  { name: 'Tailwind', files: ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs'] },
  { name: 'React', files: ['node_modules/react/package.json'] },
  { name: 'TypeScript', files: ['tsconfig.json'] },
  { name: 'Python', files: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { name: 'Go', files: ['go.mod'] },
  { name: 'Rust', files: ['Cargo.toml'] },
]

function detectTechStack(projectPath: string): string[] {
  const stack: string[] = []
  for (const def of STACK_CONFIG_FILES) {
    for (const file of def.files) {
      if (fs.existsSync(path.join(projectPath, file))) {
        stack.push(def.name)
        break
      }
    }
  }
  return stack
}

function getGitBranch(projectPath: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      timeout: 3000,
      encoding: 'utf-8',
    }).trim() || null
  } catch {
    return null
  }
}

function getMemories(
  projectPath: string,
  claudeProject: string | null
): Array<{ name: string; snippet: string }> {
  const dirName = resolveClaudeProjectDir(projectPath, claudeProject)
  const memDir = path.join(os.homedir(), '.claude', 'projects', dirName, 'memory')

  try {
    if (!fs.existsSync(memDir)) return []

    const entries = fs.readdirSync(memDir, { withFileTypes: true })
    const result: Array<{ name: string; snippet: string }> = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      const fullPath = path.join(memDir, entry.name)
      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        result.push({
          name: entry.name,
          snippet: content.slice(0, 500),
        })
      } catch {
        // Skip unreadable files
      }
    }

    // MEMORY.md first, then alphabetical
    result.sort((a, b) => {
      const aMain = a.name === 'MEMORY.md'
      const bMain = b.name === 'MEMORY.md'
      if (aMain !== bMain) return aMain ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

    return result
  } catch {
    return []
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export function registerPromptHandlers(db: Database.Database) {
  const projectDAO = new ProjectDAO(db)
  const taskDAO = new TaskDAO(db)

  // ── Gather project context ──────────────────────────────────────────────

  ipcMain.handle(
    'prompt:gatherContext',
    (_event, projectId: string): ProjectContext => {
      const project = projectDAO.getById(projectId)
      if (!project) {
        return {
          projectName: 'Unknown',
          projectPath: '',
          techStack: [],
          gitBranch: null,
          openTasks: [],
          memories: [],
        }
      }

      const techStack = detectTechStack(project.path)
      const gitBranch = getGitBranch(project.path)

      // Tasks: only todo + in_progress
      const todoTasks = taskDAO.list(projectId, 'todo')
      const inProgressTasks = taskDAO.list(projectId, 'in_progress')
      const openTasks = [...inProgressTasks, ...todoTasks]
        .slice(0, 20) // Limit to avoid bloating the context
        .map((t) => ({
          title: t.title,
          status: t.status,
          priority: String(t.priority || 'medium'),
        }))

      const memories = getMemories(project.path, project.claudeProject)

      return {
        projectName: project.name,
        projectPath: project.path,
        techStack,
        gitBranch,
        openTasks,
        memories,
      }
    }
  )

  // ── Phase 1: Clarify ───────────────────────────────────────────────────

  ipcMain.handle(
    'prompt:clarify',
    async (
      _event,
      payload: {
        originalBrief: string
        taskMode?: string
        userCorrections?: string
        model?: string
        projectContext?: ProjectContext
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

  // ── Phase 2: Generate ──────────────────────────────────────────────────

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
        projectContext?: ProjectContext
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
