const MODELS_WITH_VISION = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'gpt-4.1',
  'o3',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3-flash-preview',
  'openai/gpt-5.4',
])

const CLAUDE_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
])

const OPENAI_MODELS = new Set([
  'gpt-4.1',
  'o3',
  'o4-mini',
])

const GEMINI_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
])

const CLAUDE_EFFORT_SUPPORTED_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
])

export function normalizeProviderModelId(modelValue: string): string {
  if (!modelValue) return modelValue
  const slashIndex = modelValue.indexOf('/')
  if (slashIndex === -1) return modelValue
  return modelValue.slice(slashIndex + 1)
}

export function modelSupportsVisionById(modelValue: string): boolean {
  const normalized = normalizeProviderModelId(modelValue)
  return MODELS_WITH_VISION.has(modelValue) || MODELS_WITH_VISION.has(normalized)
}

export function modelSupportsClaudeEffortById(modelValue: string): boolean {
  const normalized = normalizeProviderModelId(modelValue)
  return CLAUDE_EFFORT_SUPPORTED_MODELS.has(normalized)
}

export function toOpenRouterModelId(modelValue: string): string {
  if (!modelValue) return modelValue
  if (modelValue.includes('/')) return modelValue

  if (CLAUDE_MODELS.has(modelValue)) return `anthropic/${modelValue}`
  if (OPENAI_MODELS.has(modelValue)) return `openai/${modelValue}`
  if (GEMINI_MODELS.has(modelValue)) return `google/${modelValue}`
  return modelValue
}
