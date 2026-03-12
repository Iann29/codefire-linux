import { describe, expect, it } from 'vitest'
import { PromptCompilerJobStore } from '../../main/services/PromptCompilerJobStore'
import type {
  PromptClarificationResult,
  PromptGenerationResult,
} from '@shared/promptCompiler'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function buildClarificationResult(): PromptClarificationResult {
  return {
    understanding: 'Entendi o objetivo principal.',
    objective: ['Refatorar o componente'],
    context: ['Projeto Electron com React'],
    constraints: ['Sem mudar o layout'],
    assumptions: ['Existe cobertura visual'],
    confirmationPrompt: 'Posso seguir para a geracao final?',
    questions: ['Qual eh o risco principal?'],
    interactiveQuestions: [],
  }
}

function buildGenerationResult(): PromptGenerationResult {
  return {
    finalPrompt: 'Final prompt output',
  }
}

describe('PromptCompilerJobStore', () => {
  it('mantem jobs executando e permite ler o resultado depois da conclusao', async () => {
    const store = new PromptCompilerJobStore()
    const deferred = createDeferred<{
      mode: 'ai' | 'demo'
      data: PromptClarificationResult
      warning?: string
    }>()

    const snapshot = store.startJob('clarify', () => deferred.promise)

    expect(snapshot.status).toBe('running')
    expect(store.getJob(snapshot.id)).toMatchObject({
      id: snapshot.id,
      kind: 'clarify',
      status: 'running',
    })

    deferred.resolve({
      mode: 'ai',
      data: buildClarificationResult(),
      warning: 'used cached provider connection',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const completed = store.getJob(snapshot.id)
    expect(completed).toMatchObject({
      id: snapshot.id,
      kind: 'clarify',
      status: 'completed',
      mode: 'ai',
      warning: 'used cached provider connection',
    })

    if (!completed || completed.kind !== 'clarify') {
      throw new Error('Expected a completed clarify job')
    }

    expect(completed.result).toEqual(buildClarificationResult())
  })

  it('marca o job como falho quando o runner rejeita', async () => {
    const store = new PromptCompilerJobStore()
    const deferred = createDeferred<{
      mode: 'ai' | 'demo'
      data: PromptGenerationResult
      warning?: string
    }>()

    const snapshot = store.startJob('generate', () => deferred.promise)
    deferred.reject(new Error('provider timeout'))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.getJob(snapshot.id)).toMatchObject({
      id: snapshot.id,
      kind: 'generate',
      status: 'failed',
      error: 'provider timeout',
    })
  })
})
