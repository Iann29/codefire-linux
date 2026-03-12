import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PromptInteractiveQuestion } from '@shared/promptCompiler'
import { createInitialAnswerMap, type PromptAnswerMap } from '@renderer/lib/promptCompilerFlow'
import { InteractiveQuestionFlow } from '../../renderer/components/PromptCompiler/InteractiveQuestionFlow'

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
    otherPlaceholder: 'Outro formato customizado',
    inputPlaceholder: 'Outro formato customizado',
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
    otherPlaceholder: 'Outra restricao importante',
    inputPlaceholder: 'Outra restricao importante',
    required: true,
  },
]

function FlowHarness({ items = questions }: { items?: PromptInteractiveQuestion[] }) {
  const [answers, setAnswers] = useState<PromptAnswerMap>(createInitialAnswerMap(items))

  return (
    <InteractiveQuestionFlow
      questions={items}
      answers={answers}
      onAnswerChange={(answer) =>
        setAnswers((prev) => ({
          ...prev,
          [answer.questionId]: answer,
        }))
      }
    />
  )
}

describe('InteractiveQuestionFlow', () => {
  it('shows and clears the Other path inline for structured questions', () => {
    render(<FlowHarness items={[questions[0]]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Outro' }))
    fireEvent.change(screen.getByPlaceholderText('Outro formato customizado'), {
      target: { value: 'Quero um diff comentado' },
    })

    expect(screen.getByText(/Outro: Quero um diff comentado/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar outro' }))

    expect(screen.queryByPlaceholderText('Outro formato customizado')).toBeNull()
    expect(screen.getByText('Sem resposta ainda')).toBeTruthy()
  })

  it('advances to the next question after completing the current one', () => {
    render(<FlowHarness />)

    fireEvent.click(screen.getByRole('button', { name: /Implementacao pronta/i }))

    expect(screen.getAllByText('Quais restricoes precisam aparecer?').length).toBeGreaterThan(0)
  })
})
