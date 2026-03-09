import { describe, expect, it } from 'vitest'
import {
  addTokenUsage,
  createRunUsageSnapshot,
  createTokenUsage,
  getConversationUsage,
} from '../../shared/chatUsage'
import type { ChatMessage } from '../../shared/models'

describe('chatUsage helpers', () => {
  it('normalizes token usage totals', () => {
    expect(createTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 25,
    })).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125,
      source: 'provider',
    })
  })

  it('accumulates usage across runs without double counting message-only records', () => {
    const runUsage = createRunUsageSnapshot(
      { prompt_tokens: 120, completion_tokens: 30 },
      { callCount: 2, provider: 'claude-subscription', model: 'claude-sonnet-4-6' },
    )

    const messages: ChatMessage[] = [
      {
        id: 1,
        conversationId: 10,
        role: 'user',
        content: 'hello',
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        conversationId: 10,
        role: 'assistant',
        content: 'world',
        createdAt: new Date().toISOString(),
        responseUsage: createTokenUsage({ prompt_tokens: 60, completion_tokens: 10 }),
        runUsage,
      },
    ]

    expect(getConversationUsage(messages)).toMatchObject({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    })
  })

  it('adds token usage values field-by-field', () => {
    expect(addTokenUsage(
      { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    )).toMatchObject({
      prompt_tokens: 15,
      completion_tokens: 5,
      total_tokens: 20,
    })
  })
})
