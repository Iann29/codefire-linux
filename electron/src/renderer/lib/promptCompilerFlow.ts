import type {
  PromptInteractiveAnswer,
  PromptInteractiveQuestion,
  PromptQuestionOption,
} from '@shared/promptCompiler'

export type PromptAnswerMap = Record<string, PromptInteractiveAnswer>

export function createEmptyPromptAnswer(questionId: string): PromptInteractiveAnswer {
  return {
    questionId,
    selectedOptionIds: [],
    textValue: '',
    otherText: '',
  }
}

export function createInitialAnswerMap(questions: PromptInteractiveQuestion[]): PromptAnswerMap {
  return questions.reduce<PromptAnswerMap>((acc, question) => {
    acc[question.id] = createEmptyPromptAnswer(question.id)
    return acc
  }, {})
}

export function getQuestionAnswer(
  answers: PromptAnswerMap,
  questionId: string
): PromptInteractiveAnswer {
  return answers[questionId] ?? createEmptyPromptAnswer(questionId)
}

export function isQuestionAnswered(
  question: PromptInteractiveQuestion,
  answer?: PromptInteractiveAnswer
): boolean {
  const resolved = answer ?? createEmptyPromptAnswer(question.id)

  if (question.responseType === 'text') {
    return hasText(resolved.textValue) || hasText(resolved.otherText)
  }

  return resolved.selectedOptionIds.length > 0 || hasText(resolved.otherText)
}

export function isQuestionComplete(
  question: PromptInteractiveQuestion,
  answer?: PromptInteractiveAnswer
): boolean {
  if (!question.required) return true
  return isQuestionAnswered(question, answer)
}

export function getAnsweredQuestionCount(
  questions: PromptInteractiveQuestion[],
  answers: PromptAnswerMap
): number {
  return questions.filter((question) => isQuestionAnswered(question, answers[question.id])).length
}

export function findFirstIncompleteQuestionId(
  questions: PromptInteractiveQuestion[],
  answers: PromptAnswerMap
): string | null {
  return questions.find((question) => !isQuestionComplete(question, answers[question.id]))?.id ?? null
}

export function buildAnswerPreview(
  question: PromptInteractiveQuestion,
  answer?: PromptInteractiveAnswer
): string {
  const parts = resolveAnswerParts(question, answer)
  if (!parts.length) return 'Sem resposta ainda'
  return parts.join(' • ')
}

export function buildAutoFilledAdjustments(
  questions: PromptInteractiveQuestion[],
  answers: PromptAnswerMap
): string {
  const lines = questions
    .map((question) => {
      const parts = resolveAnswerParts(question, answers[question.id])
      if (!parts.length) return null
      return `- ${question.label}: ${parts.join('; ')}`
    })
    .filter((line): line is string => Boolean(line))

  if (!lines.length) return ''

  return ['Respostas guiadas confirmadas pelo usuario:', ...lines].join('\n')
}

export function composeUserCorrections(
  autoFilledAdjustments: string,
  manualAdjustments: string
): string {
  const sections = [autoFilledAdjustments.trim()]

  if (manualAdjustments.trim()) {
    sections.push(`Ajustes adicionais do usuario:\n${manualAdjustments.trim()}`)
  }

  return sections.filter(Boolean).join('\n\n')
}

function resolveAnswerParts(
  question: PromptInteractiveQuestion,
  answer?: PromptInteractiveAnswer
): string[] {
  const resolved = answer ?? createEmptyPromptAnswer(question.id)
  const optionLabels = resolved.selectedOptionIds
    .map((optionId) => findOptionLabel(question.options, optionId))
    .filter((label): label is string => Boolean(label))

  const parts = question.responseType === 'text' ? [] : [...optionLabels]

  if (hasText(resolved.textValue)) {
    parts.push(resolved.textValue.trim())
  }

  if (hasText(resolved.otherText)) {
    parts.push(`Outro: ${resolved.otherText.trim()}`)
  }

  return unique(parts)
}

function findOptionLabel(options: PromptQuestionOption[], optionId: string): string | null {
  return options.find((option) => option.id === optionId)?.label ?? null
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}
