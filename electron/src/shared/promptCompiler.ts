export type PromptQuestionResponseType = 'single' | 'multi' | 'text'

export interface PromptQuestionOption {
  id: string
  label: string
  description?: string
}

export interface PromptInteractiveQuestion {
  id: string
  label: string
  helperText?: string
  responseType: PromptQuestionResponseType
  options: PromptQuestionOption[]
  allowsOther: boolean
  otherPlaceholder?: string
  inputPlaceholder?: string
  required: boolean
}

export interface PromptClarificationResult {
  understanding: string
  objective: string[]
  context: string[]
  constraints: string[]
  assumptions: string[]
  confirmationPrompt: string
  questions: string[]
  interactiveQuestions: PromptInteractiveQuestion[]
}

export interface PromptGenerationResult {
  finalPrompt: string
}

export interface PromptInteractiveAnswer {
  questionId: string
  selectedOptionIds: string[]
  textValue: string
  otherText: string
}
