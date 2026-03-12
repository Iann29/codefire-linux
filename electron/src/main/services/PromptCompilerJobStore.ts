import { randomUUID } from 'node:crypto'
import type {
  PromptCompilerJobKind,
  PromptCompilerJobSnapshot,
} from '@shared/promptCompiler'
import type { ClarificationResult, GenerationResult } from './PromptCompilerService'

type PromptCompilerJobOutcome<TKind extends PromptCompilerJobKind> = {
  mode: 'ai' | 'demo'
  data: TKind extends 'clarify' ? ClarificationResult : GenerationResult
  warning?: string
}

interface PromptCompilerJobStoreOptions {
  completedJobTtlMs?: number
}

export class PromptCompilerJobStore {
  private readonly jobs = new Map<string, PromptCompilerJobSnapshot>()
  private readonly completedJobTtlMs: number

  constructor(options: PromptCompilerJobStoreOptions = {}) {
    this.completedJobTtlMs = options.completedJobTtlMs ?? 30 * 60 * 1000
  }

  startJob<TKind extends PromptCompilerJobKind>(
    kind: TKind,
    runner: () => Promise<PromptCompilerJobOutcome<TKind>>
  ): PromptCompilerJobSnapshot {
    this.pruneCompletedJobs()

    const now = Date.now()
    const snapshot = {
      id: randomUUID(),
      kind,
      status: 'running',
      mode: null,
      result: null,
      startedAt: now,
      updatedAt: now,
    } as PromptCompilerJobSnapshot

    this.jobs.set(snapshot.id, snapshot)

    void runner()
      .then((result) => {
        const current = this.jobs.get(snapshot.id)
        if (!current) return

        this.jobs.set(snapshot.id, {
          ...current,
          status: 'completed',
          mode: result.mode,
          warning: result.warning,
          result: result.data,
          updatedAt: Date.now(),
        } as PromptCompilerJobSnapshot)
      })
      .catch((error) => {
        const current = this.jobs.get(snapshot.id)
        if (!current) return

        this.jobs.set(snapshot.id, {
          ...current,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        } as PromptCompilerJobSnapshot)
      })

    return snapshot
  }

  getJob(jobId: string): PromptCompilerJobSnapshot | null {
    this.pruneCompletedJobs()
    return this.jobs.get(jobId) ?? null
  }

  private pruneCompletedJobs() {
    const now = Date.now()

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'running') continue
      if (now - job.updatedAt <= this.completedJobTtlMs) continue
      this.jobs.delete(jobId)
    }
  }
}

export const promptCompilerJobStore = new PromptCompilerJobStore()
