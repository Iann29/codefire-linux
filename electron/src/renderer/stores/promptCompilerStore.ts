import { api } from '@renderer/lib/api'
import {
  createInitialAnswerMap,
  type PromptAnswerMap,
} from '@renderer/lib/promptCompilerFlow'
import type { ProjectContext } from '@shared/models'
import type {
  PromptClarificationResult,
  PromptCompilerJobSnapshot,
  PromptGenerationResult,
  PromptInteractiveAnswer,
} from '@shared/promptCompiler'

export interface ContextToggles {
  techStack: boolean
  gitBranch: boolean
  tasks: boolean
  memories: boolean
}

export interface PromptCompilerProjectState {
  brief: string
  manualAdjustments: string
  guidedAnswers: PromptAnswerMap
  selectedModel: string
  contextOpen: boolean
  toggles: ContextToggles
  lastGeneratedCorrections: string
  clarification: PromptClarificationResult | null
  generation: PromptGenerationResult | null
  clarifying: boolean
  generating: boolean
  warning: string | null
  mode: 'ai' | 'demo' | null
  projectContext: ProjectContext | null
  contextLoading: boolean
  activeJobId: string | null
  activeJobKind: 'clarify' | 'generate' | null
}

interface PersistedPromptCompilerStore {
  version: 1
  projects: Record<string, PromptCompilerProjectState>
}

type Listener = () => void

const STORAGE_VERSION = 1
const JOB_POLL_INTERVAL_MS = 750

export const PROMPT_COMPILER_SESSION_STORAGE_KEY = 'codefire:prompt-compiler-state:v1'

export const DEFAULT_PROMPT_CONTEXT_TOGGLES: ContextToggles = {
  techStack: true,
  gitBranch: true,
  tasks: true,
  memories: true,
}

const listeners = new Set<Listener>()
const projectStates = new Map<string, PromptCompilerProjectState>()
const activeJobPollers = new Map<string, Promise<void>>()
const activeContextRequests = new Map<string, Promise<ProjectContext | null>>()

let hydrated = false

function createDefaultState(): PromptCompilerProjectState {
  return {
    brief: '',
    manualAdjustments: '',
    guidedAnswers: {},
    selectedModel: '',
    contextOpen: true,
    toggles: { ...DEFAULT_PROMPT_CONTEXT_TOGGLES },
    lastGeneratedCorrections: '',
    clarification: null,
    generation: null,
    clarifying: false,
    generating: false,
    warning: null,
    mode: null,
    projectContext: null,
    contextLoading: false,
    activeJobId: null,
    activeJobKind: null,
  }
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function notify() {
  listeners.forEach((listener) => listener())
}

function persist() {
  if (!hasSessionStorage()) return

  try {
    const projects = Object.fromEntries(projectStates.entries())
    const payload: PersistedPromptCompilerStore = {
      version: STORAGE_VERSION,
      projects,
    }
    window.sessionStorage.setItem(PROMPT_COMPILER_SESSION_STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('[promptCompilerStore] Failed to persist state:', error)
  }
}

function ensureHydrated() {
  if (hydrated) return
  hydrated = true

  if (!hasSessionStorage()) return

  try {
    const raw = window.sessionStorage.getItem(PROMPT_COMPILER_SESSION_STORAGE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw) as Partial<PersistedPromptCompilerStore>
    if (parsed.version !== STORAGE_VERSION || !parsed.projects) return

    for (const [projectId, state] of Object.entries(parsed.projects)) {
      projectStates.set(projectId, {
        ...createDefaultState(),
        ...state,
        toggles: {
          ...DEFAULT_PROMPT_CONTEXT_TOGGLES,
          ...state.toggles,
        },
      })
    }
  } catch (error) {
    console.warn('[promptCompilerStore] Failed to restore state:', error)
  }
}

function getOrCreateState(projectId: string): PromptCompilerProjectState {
  ensureHydrated()

  const existing = projectStates.get(projectId)
  if (existing) return existing

  const initialState = createDefaultState()
  projectStates.set(projectId, initialState)
  return initialState
}

function updateState(
  projectId: string,
  updater: (current: PromptCompilerProjectState) => PromptCompilerProjectState
): PromptCompilerProjectState {
  const next = updater(getOrCreateState(projectId))
  projectStates.set(projectId, next)
  persist()
  notify()
  return next
}

function filterContext(
  context: ProjectContext | null,
  toggles: ContextToggles
): ProjectContext | undefined {
  if (!context) return undefined

  const anyEnabled = toggles.techStack || toggles.gitBranch || toggles.tasks || toggles.memories
  if (!anyEnabled) return undefined

  return {
    projectName: context.projectName,
    projectPath: context.projectPath,
    techStack: toggles.techStack ? context.techStack : [],
    gitBranch: toggles.gitBranch ? context.gitBranch : null,
    openTasks: toggles.tasks ? context.openTasks : [],
    memories: toggles.memories ? context.memories : [],
  }
}

function getJobMissingMessage(kind: 'clarify' | 'generate'): string {
  return kind === 'clarify'
    ? 'A interpretacao em andamento nao pode ser retomada apos o reload.'
    : 'A geracao em andamento nao pode ser retomada apos o reload.'
}

function getJobFailureMessage(snapshot: PromptCompilerJobSnapshot): string {
  const base = snapshot.kind === 'clarify'
    ? 'Falha ao interpretar o briefing.'
    : 'Falha ao gerar o prompt final.'

  return snapshot.error ? `${base} ${snapshot.error}` : base
}

function applyJobSnapshot(projectId: string, snapshot: PromptCompilerJobSnapshot) {
  updateState(projectId, (current) => {
    const nextBase: PromptCompilerProjectState = {
      ...current,
      activeJobId: snapshot.status === 'running' ? snapshot.id : null,
      activeJobKind: snapshot.status === 'running' ? snapshot.kind : null,
      clarifying: snapshot.kind === 'clarify' && snapshot.status === 'running',
      generating: snapshot.kind === 'generate' && snapshot.status === 'running',
      mode: snapshot.mode ?? current.mode,
      warning: snapshot.status === 'running' ? null : current.warning,
    }

    if (snapshot.status === 'completed') {
      if (snapshot.kind === 'clarify' && snapshot.result) {
        return {
          ...nextBase,
          clarification: snapshot.result,
          generation: null,
          guidedAnswers: createInitialAnswerMap(snapshot.result.interactiveQuestions),
          manualAdjustments: '',
          lastGeneratedCorrections: '',
          warning: snapshot.warning ?? null,
          mode: snapshot.mode,
        }
      }

      if (snapshot.kind === 'generate' && snapshot.result) {
        return {
          ...nextBase,
          generation: snapshot.result,
          warning: snapshot.warning ?? null,
          mode: snapshot.mode,
        }
      }
    }

    if (snapshot.status === 'failed') {
      return {
        ...nextBase,
        warning: getJobFailureMessage(snapshot),
      }
    }

    return nextBase
  })
}

function markPendingJobAsInterrupted(projectId: string, jobId: string, kind: 'clarify' | 'generate') {
  updateState(projectId, (current) => {
    if (current.activeJobId !== jobId) {
      return current
    }

    return {
      ...current,
      activeJobId: null,
      activeJobKind: null,
      clarifying: false,
      generating: false,
      warning: current.warning ?? getJobMissingMessage(kind),
    }
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function trackJob(projectId: string, jobId: string, kind: 'clarify' | 'generate') {
  if (activeJobPollers.has(jobId)) {
    await activeJobPollers.get(jobId)
    return
  }

  const poller = (async () => {
    try {
      while (true) {
        const snapshot = await api.promptCompiler.getJob(jobId)

        if (!snapshot) {
          markPendingJobAsInterrupted(projectId, jobId, kind)
          return
        }

        applyJobSnapshot(projectId, snapshot)

        if (snapshot.status !== 'running') {
          return
        }

        await sleep(JOB_POLL_INTERVAL_MS)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateState(projectId, (current) => ({
        ...current,
        activeJobId: null,
        activeJobKind: null,
        clarifying: false,
        generating: false,
        warning: getJobFailureMessage({
          id: jobId,
          kind,
          status: 'failed',
          mode: current.mode,
          error: message,
          result: null,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        }),
      }))
    }
  })().finally(() => {
    activeJobPollers.delete(jobId)
  })

  activeJobPollers.set(jobId, poller)
  await poller
}

export const promptCompilerStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getState(projectId: string): PromptCompilerProjectState {
    return getOrCreateState(projectId)
  },

  ensureRecovered(projectId: string) {
    const state = getOrCreateState(projectId)

    if (state.contextLoading && !state.projectContext && !activeContextRequests.has(projectId)) {
      void this.fetchContext(projectId)
    }

    if (state.activeJobId && state.activeJobKind) {
      void trackJob(projectId, state.activeJobId, state.activeJobKind)
      return
    }

    if (state.clarifying || state.generating) {
      updateState(projectId, (current) => ({
        ...current,
        clarifying: false,
        generating: false,
        warning:
          current.warning ??
          (current.clarifying
            ? getJobMissingMessage('clarify')
            : getJobMissingMessage('generate')),
      }))
    }
  },

  setBrief(projectId: string, brief: string) {
    updateState(projectId, (current) => ({ ...current, brief }))
  },

  setManualAdjustments(projectId: string, manualAdjustments: string) {
    updateState(projectId, (current) => ({ ...current, manualAdjustments }))
  },

  setGuidedAnswer(projectId: string, answer: PromptInteractiveAnswer) {
    updateState(projectId, (current) => ({
      ...current,
      guidedAnswers: {
        ...current.guidedAnswers,
        [answer.questionId]: answer,
      },
    }))
  },

  setSelectedModel(projectId: string, selectedModel: string) {
    updateState(projectId, (current) => ({ ...current, selectedModel }))
  },

  setContextOpen(projectId: string, contextOpen: boolean) {
    updateState(projectId, (current) => ({ ...current, contextOpen }))
  },

  toggleContextSetting(projectId: string, key: keyof ContextToggles) {
    updateState(projectId, (current) => ({
      ...current,
      toggles: {
        ...current.toggles,
        [key]: !current.toggles[key],
      },
    }))
  },

  async fetchContext(projectId: string) {
    if (activeContextRequests.has(projectId)) {
      return activeContextRequests.get(projectId)!
    }

    updateState(projectId, (current) => ({
      ...current,
      contextLoading: true,
    }))

    const request = (async () => {
      try {
        const projectContext = await api.promptCompiler.gatherContext(projectId)
        updateState(projectId, (current) => ({
          ...current,
          projectContext,
          contextLoading: false,
        }))
        return projectContext
      } catch (error) {
        console.error('[promptCompilerStore] Failed to gather project context:', error)
        updateState(projectId, (current) => ({
          ...current,
          projectContext: null,
          contextLoading: false,
        }))
        return null
      } finally {
        activeContextRequests.delete(projectId)
      }
    })()

    activeContextRequests.set(projectId, request)
    return request
  },

  async clarify(projectId: string) {
    const current = getOrCreateState(projectId)
    const originalBrief = current.brief.trim()
    if (!originalBrief) return null

    updateState(projectId, (state) => ({
      ...state,
      manualAdjustments: '',
      guidedAnswers: {},
      clarification: null,
      generation: null,
      clarifying: true,
      generating: false,
      warning: null,
      mode: null,
      activeJobId: null,
      activeJobKind: null,
      lastGeneratedCorrections: '',
    }))

    try {
      const snapshot = await api.promptCompiler.startClarify({
        originalBrief,
        model: current.selectedModel || undefined,
        projectContext: filterContext(current.projectContext, current.toggles),
      })

      applyJobSnapshot(projectId, snapshot)
      await trackJob(projectId, snapshot.id, 'clarify')
      return snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateState(projectId, (state) => ({
        ...state,
        clarifying: false,
        activeJobId: null,
        activeJobKind: null,
        warning: `Falha ao interpretar o briefing. ${message}`,
      }))
      throw error
    }
  },

  async generate(projectId: string, userCorrections: string) {
    const current = getOrCreateState(projectId)
    if (!current.clarification) return null

    updateState(projectId, (state) => ({
      ...state,
      generation: null,
      generating: true,
      clarifying: false,
      warning: null,
      activeJobId: null,
      activeJobKind: null,
      lastGeneratedCorrections: userCorrections,
    }))

    try {
      const snapshot = await api.promptCompiler.startGenerate({
        originalBrief: current.brief,
        userCorrections,
        clarification: current.clarification,
        model: current.selectedModel || undefined,
        projectContext: filterContext(current.projectContext, current.toggles),
      })

      applyJobSnapshot(projectId, snapshot)
      await trackJob(projectId, snapshot.id, 'generate')
      return snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateState(projectId, (state) => ({
        ...state,
        generating: false,
        activeJobId: null,
        activeJobKind: null,
        warning: `Falha ao gerar o prompt final. ${message}`,
      }))
      throw error
    }
  },

  clearGeneration(projectId: string) {
    updateState(projectId, (current) => ({
      ...current,
      generation: null,
      lastGeneratedCorrections: '',
    }))
  },

  reset(projectId: string) {
    updateState(projectId, (current) => ({
      ...current,
      brief: '',
      manualAdjustments: '',
      guidedAnswers: {},
      lastGeneratedCorrections: '',
      clarification: null,
      generation: null,
      clarifying: false,
      generating: false,
      warning: null,
      mode: null,
      activeJobId: null,
      activeJobKind: null,
    }))
  },
}
