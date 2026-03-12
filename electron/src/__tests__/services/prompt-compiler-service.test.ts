import { describe, expect, it } from 'vitest'

import {
  buildGenerateRequest,
  buildGenerationFallback,
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
    expect(result.questions.some((question) => /stack|tecnolog/i.test(question))).toBe(false)
  })

  it('filters generic technical discovery questions when repository context already exists', () => {
    const result = sanitizeClarifyResponse(
      {
        understanding: 'Entendimento ok',
        objective: ['Objetivo 1'],
        context: ['Contexto 1'],
        constraints: ['Restricao 1'],
        assumptions: ['Suposicao 1'],
        confirmationPrompt: 'Confere?',
        questions: ['Qual stack ou tecnologias devo assumir para gerar um prompt tecnico melhor?'],
      },
      basePayload
    )

    expect(result.questions.some((question) => /stack|tecnolog/i.test(question))).toBe(false)
    expect(
      result.interactiveQuestions.some((question) => /stack|tecnolog/i.test(question.label))
    ).toBe(false)
  })

  it('tells phase 2 to flatten prompt-authoring requests into the final direct prompt', () => {
    const request = buildGenerateRequest({
      ...basePayload,
      originalBrief:
        'Quero ajustar o prompt base do agente para ele investigar a codebase antes de perguntar detalhes tecnicos ao usuario.',
      userCorrections: 'Escreva em portugues e nao pergunte follow-ups.',
    })

    expect(request.instructions).toContain(
      'generate the final deliverable prompt itself, ready to paste into the target agent'
    )
    expect(request.instructions).toContain(
      'Do not output a prompt that asks another AI to create, improve, rewrite, or design the prompt you are supposed to deliver.'
    )
    expect(request.instructions).toContain('The deliverable language should be Portuguese (Brazil).')
  })

  it('keeps normal implementation briefs as implementation prompts instead of direct prompt-authoring mode', () => {
    const request = buildGenerateRequest({
      ...basePayload,
      originalBrief:
        'Quero um prompt forte para outra IA implementar um fluxo de onboarding no app sem quebrar o layout atual.',
      userCorrections: '',
    })

    expect(request.instructions).toContain('generate one strong final prompt in English')
    expect(request.instructions).not.toContain(
      'generate the final deliverable prompt itself, ready to paste into the target agent'
    )
  })

  it('treats repo prompt-artifact changes as implementation tasks rather than standalone prompt deliverables', () => {
    const request = buildGenerateRequest({
      ...basePayload,
      originalBrief:
        'Revise o prompt/base de instrucoes do agente usado no projeto codefire-app para incorporar uma regra explicita apenas na fase de descoberta.',
      userCorrections:
        'Localize os arquivos certos no repositorio, altere-os diretamente e informe os arquivos alterados com o version bump em electron/package.json.',
    })

    expect(request.instructions).toContain(
      'The user is not asking for prompt engineering in the abstract. They want a coding agent to update prompt or instruction artifacts that live inside the repository.'
    )
    expect(request.instructions).toContain(
      'make repository investigation the default technical discovery path: codebase first, documentation second, user questions last.'
    )
    expect(request.instructions).toContain(
      'The final prompt should tell the worker agent to inspect the codebase, locate the current prompt/instruction artifact, consult relevant documentation if repository evidence is incomplete, edit it in place, validate the change, and report the touched files.'
    )
    expect(request.instructions).not.toContain(
      'generate the final deliverable prompt itself, ready to paste into the target agent'
    )
  })

  it('builds a direct paste-ready fallback when the requested deliverable is itself an agent prompt', () => {
    const result = buildGenerationFallback({
      ...basePayload,
      originalBrief:
        'Preciso atualizar o prompt inicial do agente deste projeto para ele investigar a codebase antes de perguntar stack.',
      userCorrections:
        'Respostas guiadas confirmadas pelo usuario:\n- Escreva em portugues\n- Nao faca perguntas de descoberta tecnica ao usuario',
    })

    expect(result.finalPrompt).toContain('Voce esta trabalhando no projeto CodeFire')
    expect(result.finalPrompt).toContain('Entregue diretamente o prompt ou bloco de instrucoes final')
    expect(result.finalPrompt).toContain('Assuma que o usuario pode nao saber stack')
    expect(result.finalPrompt).toContain('Investigue manifestos, lockfiles, configs de build ou framework')
    expect(result.finalPrompt).not.toContain('Role\nYou are')
    expect(result.finalPrompt).not.toContain('Create a prompt')
  })

  it('keeps repo prompt-artifact requests in repository-implementation fallback mode', () => {
    const result = buildGenerationFallback({
      ...basePayload,
      originalBrief:
        'Revise o prompt/base de instrucoes do agente usado no projeto codefire-app para incorporar uma regra explicita apenas na fase de descoberta.',
      userCorrections:
        'Localize os arquivos certos no repositorio, altere-os diretamente e informe os arquivos alterados com o version bump em electron/package.json.',
    })

    expect(result.finalPrompt).toContain('Complete this software implementation task in the relevant codebase or product')
    expect(result.finalPrompt).toContain('Project: CodeFire (/tmp/codefire-app)')
    expect(result.finalPrompt).not.toContain('Entregue diretamente o prompt ou bloco de instrucoes final')
  })
})
