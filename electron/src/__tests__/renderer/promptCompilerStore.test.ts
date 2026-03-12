import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PromptClarificationResult,
  PromptCompilerJobSnapshot,
  PromptGenerationResult,
} from '@shared/promptCompiler'

const mockPromptCompilerApi = {
  gatherContext: vi.fn(),
  startClarify: vi.fn(),
  startGenerate: vi.fn(),
  getJob: vi.fn(),
}

vi.mock('@renderer/lib/api', () => ({
  api: {
    promptCompiler: mockPromptCompilerApi,
  },
}))

function buildClarificationResult(): PromptClarificationResult {
  return {
    understanding: 'Entendimento salvo',
    objective: ['Objetivo principal'],
    context: ['Contexto importante'],
    constraints: ['Restricao critica'],
    assumptions: ['Suposicao atual'],
    confirmationPrompt: 'Confirmar entendimento?',
    questions: ['Qual formato final?'],
    interactiveQuestions: [
      {
        id: 'format',
        label: 'Qual formato final?',
        helperText: 'Define a estrutura do resultado.',
        responseType: 'single',
        options: [
          { id: 'checklist', label: 'Checklist' },
          { id: 'patch', label: 'Patch' },
        ],
        allowsOther: true,
        required: true,
      },
    ],
  }
}

function buildGenerationResult(): PromptGenerationResult {
  return {
    finalPrompt: 'Prompt final persistido',
  }
}

function buildRunningSnapshot(id: string, kind: 'clarify' | 'generate'): PromptCompilerJobSnapshot {
  return {
    id,
    kind,
    status: 'running',
    mode: null,
    result: null,
    startedAt: 100,
    updatedAt: 100,
  }
}

describe('promptCompilerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    window.sessionStorage.clear()
  })

  it('persiste inputs e resultados entre recarregamentos do renderer', async () => {
    const clarification = buildClarificationResult()
    const generation = buildGenerationResult()

    mockPromptCompilerApi.startClarify.mockResolvedValue(buildRunningSnapshot('job-clarify', 'clarify'))
    mockPromptCompilerApi.startGenerate.mockResolvedValue(buildRunningSnapshot('job-generate', 'generate'))
    mockPromptCompilerApi.getJob
      .mockResolvedValueOnce({
        id: 'job-clarify',
        kind: 'clarify',
        status: 'completed',
        mode: 'ai',
        result: clarification,
        startedAt: 100,
        updatedAt: 120,
      })
      .mockResolvedValueOnce({
        id: 'job-generate',
        kind: 'generate',
        status: 'completed',
        mode: 'ai',
        result: generation,
        startedAt: 200,
        updatedAt: 240,
      })

    const { promptCompilerStore } = await import('@renderer/stores/promptCompilerStore')
    const projectId = 'project-1'

    promptCompilerStore.setBrief(projectId, 'Refatorar sem regressao visual')
    promptCompilerStore.setSelectedModel(projectId, 'openai/gpt-5.4')
    promptCompilerStore.setContextOpen(projectId, false)
    promptCompilerStore.toggleContextSetting(projectId, 'memories')

    await promptCompilerStore.clarify(projectId)

    promptCompilerStore.setGuidedAnswer(projectId, {
      questionId: 'format',
      selectedOptionIds: ['patch'],
      textValue: '',
      otherText: '',
    })
    promptCompilerStore.setManualAdjustments(projectId, 'Manter validacao visual atual')

    await promptCompilerStore.generate(projectId, 'Respostas guiadas confirmadas pelo usuario:\n- Qual formato final?: Patch')

    vi.resetModules()

    const { promptCompilerStore: reloadedStore } = await import('@renderer/stores/promptCompilerStore')
    const restored = reloadedStore.getState(projectId)

    expect(restored.brief).toBe('Refatorar sem regressao visual')
    expect(restored.selectedModel).toBe('openai/gpt-5.4')
    expect(restored.contextOpen).toBe(false)
    expect(restored.toggles.memories).toBe(false)
    expect(restored.manualAdjustments).toBe('Manter validacao visual atual')
    expect(restored.guidedAnswers.format?.selectedOptionIds).toEqual(['patch'])
    expect(restored.clarification).toEqual(clarification)
    expect(restored.generation).toEqual(generation)
    expect(restored.generating).toBe(false)
    expect(restored.activeJobId).toBeNull()
  })

  it('retoma um job pendente salvo em sessionStorage apos reload', async () => {
    const clarification = buildClarificationResult()
    const generation = buildGenerationResult()

    window.sessionStorage.setItem(
      'codefire:prompt-compiler-state:v1',
      JSON.stringify({
        version: 1,
        projects: {
          'project-2': {
            brief: 'Gerar prompt final',
            manualAdjustments: 'Manter tom objetivo',
            guidedAnswers: {},
            selectedModel: 'openai/gpt-5.4',
            contextOpen: true,
            toggles: {
              techStack: true,
              gitBranch: true,
              tasks: true,
              memories: true,
            },
            lastGeneratedCorrections: 'Manter tom objetivo',
            clarification,
            generation: null,
            clarifying: false,
            generating: true,
            warning: null,
            mode: null,
            projectContext: null,
            contextLoading: false,
            activeJobId: 'job-pending',
            activeJobKind: 'generate',
          },
        },
      })
    )

    mockPromptCompilerApi.getJob.mockResolvedValue({
      id: 'job-pending',
      kind: 'generate',
      status: 'completed',
      mode: 'demo',
      result: generation,
      startedAt: 300,
      updatedAt: 360,
      warning: 'Fallback local usado',
    })

    const { promptCompilerStore } = await import('@renderer/stores/promptCompilerStore')

    promptCompilerStore.ensureRecovered('project-2')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const restored = promptCompilerStore.getState('project-2')
    expect(restored.generating).toBe(false)
    expect(restored.activeJobId).toBeNull()
    expect(restored.mode).toBe('demo')
    expect(restored.warning).toBe('Fallback local usado')
    expect(restored.generation).toEqual(generation)
  })
})
