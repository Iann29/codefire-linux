export interface ChatCompletionRequest {
  model: string
  messages: Array<Record<string, unknown>>
  tools?: ReadonlyArray<Record<string, unknown>>
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface ChatCompletionToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatCompletionMessage {
  content: unknown
  tool_calls?: ChatCompletionToolCall[]
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatCompletionMessage
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface ModelInfo {
  id: string
  name: string
}

export interface ProviderHealth {
  ok: boolean
  latencyMs?: number
  error?: string
}

export interface ProviderAdapter {
  readonly id: string
  readonly name: string
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
  listModels(): Promise<ModelInfo[]>
  healthCheck(): Promise<ProviderHealth>
}
