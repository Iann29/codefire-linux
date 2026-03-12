import { describe, expect, it } from 'vitest'

import type { PromptInteractiveQuestion } from '@shared/promptCompiler'
import {
  buildAutoFilledAdjustments,
  composeUserCorrections,
  createEmptyPromptAnswer,
  isQuestionComplete,
} from '../../renderer/lib/promptCompilerFlow'

const questions: PromptInteractiveQuestion[] = [
  {
    id: 'delivery-shape',
    label: 'Qual formato de entrega voce prefere?',
    helperText: 'Escolha a saida principal.',
    responseType: 'single',
    options: [
      { id: 'implementation', label: 'Implementacao pronta' },
      { id: 'plan', label: 'Plano detalhado' },
    ],
    allowsOther: true,
    otherPlaceholder: 'Outro formato',
    inputPlaceholder: 'Outro formato',
    required: true,
  },
  {
    id: 'constraints',
    label: 'Quais restricoes precisam aparecer?',
    helperText: 'Pode marcar varias.',
    responseType: 'multi',
    options: [
      { id: 'layout', label: 'Manter layout' },
      { id: 'behavior', label: 'Preservar comportamento' },
    ],
    allowsOther: true,
    otherPlaceholder: 'Outra restricao',
    inputPlaceholder: 'Outra restricao',
    required: true,
  },
]

describe('promptCompilerFlow helpers', () => {
  it('builds a coherent auto-filled adjustments block from structured answers', () => {
    const answers = {
      'delivery-shape': {
        questionId: 'delivery-shape',
        selectedOptionIds: ['implementation'],
        textValue: '',
        otherText: '',
      },
      constraints: {
        questionId: 'constraints',
        selectedOptionIds: ['layout'],
        textValue: '',
        otherText: 'Sem dependencias novas',
      },
    }

    expect(buildAutoFilledAdjustments(questions, answers)).toBe(
      [
        'Respostas guiadas confirmadas pelo usuario:',
        '- Qual formato de entrega voce prefere?: Implementacao pronta',
        '- Quais restricoes precisam aparecer?: Manter layout; Outro: Sem dependencias novas',
      ].join('\n')
    )
  })

  it('treats the custom Other path as a valid completion and reflects later edits', () => {
    const answer = {
      ...createEmptyPromptAnswer('delivery-shape'),
      otherText: 'Quero um diff comentado',
    }

    expect(isQuestionComplete(questions[0], answer)).toBe(true)

    const editedAnswers = {
      'delivery-shape': {
        ...answer,
        selectedOptionIds: [],
        otherText: '',
        textValue: '',
      },
      constraints: {
        ...createEmptyPromptAnswer('constraints'),
        selectedOptionIds: ['behavior'],
        otherText: '',
      },
    }

    expect(buildAutoFilledAdjustments(questions, editedAnswers)).toBe(
      [
        'Respostas guiadas confirmadas pelo usuario:',
        '- Quais restricoes precisam aparecer?: Preservar comportamento',
      ].join('\n')
    )

    expect(
      composeUserCorrections(
        buildAutoFilledAdjustments(questions, editedAnswers),
        'Incluir validacao manual no final.'
      )
    ).toContain('Ajustes adicionais do usuario:\nIncluir validacao manual no final.')
  })
})
