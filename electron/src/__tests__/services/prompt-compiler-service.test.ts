import { describe, expect, it } from 'vitest'

import {
  buildClarificationFallback,
  sanitizeClarifyResponse,
  type PromptPayload,
} from '../../main/services/PromptCompilerService'

const basePayload: PromptPayload = {
  originalBrief:
    'Quero melhorar a aba Prompt Compiler de um app Electron com React e TypeScript, deixando o fechamento da fase 1 mais guiado.',
  taskMode: 'coding',
  userCorrections: '',
  clarification: null,
  projectContext: {
    projectName: 'CodeFire',
    projectPath: '/tmp/codefire-app',
    techStack: ['Electron', 'React', 'TypeScript'],
    gitBranch: 'main',
    openTasks: [],
    memories: [],
  },
}

describe('PromptCompilerService clarification schema', () => {
  it('normalizes structured interactive questions and mirrors labels into the legacy list', () => {
    const result = sanitizeClarifyResponse(
      {
        understanding: 'Entendimento ok',
        objective: ['Objetivo 1'],
        context: ['Contexto 1'],
        constraints: ['Restricao 1'],
        assumptions: ['Suposicao 1'],
        confirmationPrompt: 'Confere?',
        interactiveQuestions: [
          {
            id: 'delivery-shape',
            label: 'Qual formato de entrega voce prefere?',
            helperText: 'Escolha a saida mais util.',
            responseType: 'single',
            options: [
              'Implementacao pronta',
              { label: 'Plano detalhado', description: 'Com passos e validacao.' },
            ],
            required: false,
          },
        ],
      },
      basePayload
    )

    expect(result.interactiveQuestions).toHaveLength(1)
    expect(result.interactiveQuestions[0]).toMatchObject({
      id: 'delivery-shape',
      label: 'Qual formato de entrega voce prefere?',
      responseType: 'single',
      required: false,
      allowsOther: true,
    })
    expect(result.interactiveQuestions[0].options).toEqual([
      {
        id: 'implementacao-pronta',
        label: 'Implementacao pronta',
      },
      {
        id: 'plano-detalhado',
        label: 'Plano detalhado',
        description: 'Com passos e validacao.',
      },
    ])
    expect(result.questions).toContain('Qual formato de entrega voce prefere?')
  })

  it('derives interactive questions from legacy plain strings when the AI omits the new schema', () => {
    const result = sanitizeClarifyResponse(
      {
        understanding: 'Entendimento ok',
        objective: ['Objetivo 1'],
        context: ['Contexto 1'],
        constraints: ['Restricao 1'],
        assumptions: ['Suposicao 1'],
        confirmationPrompt: 'Confere?',
        questions: [
          'Existe alguma restricao importante de escopo, estilo, prazo ou comportamento que o prompt final precisa preservar?',
        ],
      },
      basePayload
    )

    expect(result.interactiveQuestions).toHaveLength(1)
    expect(result.interactiveQuestions[0].responseType).toBe('multi')
    expect(result.interactiveQuestions[0].options.map((option) => option.label)).toContain(
      'Preservar comportamento'
    )
  })

  it('produces fallback interactive questions when the brief still has critical gaps', () => {
    const result = buildClarificationFallback({
      ...basePayload,
      originalBrief: 'Preciso melhorar um fluxo de login.',
      projectContext: undefined,
    })

    expect(result.questions.length).toBeGreaterThan(0)
    expect(result.interactiveQuestions.length).toBeGreaterThan(0)
    expect(result.interactiveQuestions.every((question) => question.allowsOther)).toBe(true)
  })
})
