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

export type PromptCompilerJobKind = 'clarify' | 'generate'

export type PromptCompilerJobStatus = 'running' | 'completed' | 'failed'

interface PromptCompilerJobBase {
  id: string
  kind: PromptCompilerJobKind
  status: PromptCompilerJobStatus
  mode: 'ai' | 'demo' | null
  warning?: string
  error?: string
  startedAt: number
  updatedAt: number
}

export interface PromptCompilerClarifyJobSnapshot extends PromptCompilerJobBase {
  kind: 'clarify'
  result: PromptClarificationResult | null
}

export interface PromptCompilerGenerateJobSnapshot extends PromptCompilerJobBase {
  kind: 'generate'
  result: PromptGenerationResult | null
}

export type PromptCompilerJobSnapshot =
  | PromptCompilerClarifyJobSnapshot
  | PromptCompilerGenerateJobSnapshot

export interface PromptInteractiveAnswer {
  questionId: string
  selectedOptionIds: string[]
  textValue: string
  otherText: string
}
