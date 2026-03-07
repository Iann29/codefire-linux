import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  estimateMessageTokens,
  estimateContextTokens,
} from '../../main/services/TokenEstimator'
import { ContextCompactor } from '../../main/services/ContextCompactor'
import { buildDomMapScript } from '../../main/browser/dom-map'
import { buildNuclearClickScript } from '../../main/browser/nuclear-click'
import { buildNuclearTypeScript } from '../../main/browser/nuclear-type'

// ---------------------------------------------------------------------------
// TokenEstimator
// ---------------------------------------------------------------------------
describe('TokenEstimator', () => {
  it('estimateTokens returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('estimateTokens returns a positive number for non-empty string', () => {
    expect(estimateTokens('hello')).toBeGreaterThan(0)
  })

  it('estimateMessageTokens returns > 4 for a simple user message', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'hello world' })
    expect(tokens).toBeGreaterThan(4)
  })

  it('estimateMessageTokens adds ~1200 for image content blocks', () => {
    const withoutImage = estimateMessageTokens({ role: 'user', content: 'text' })
    const withImage = estimateMessageTokens({
      role: 'user',
      content: [
        { type: 'text', text: 'text' },
        { type: 'image', source: 'data:...' },
      ],
    })
    // The image block should add approximately 1200 tokens
    expect(withImage - withoutImage).toBeGreaterThanOrEqual(1100)
    expect(withImage - withoutImage).toBeLessThanOrEqual(1300)
  })

  it('estimateContextTokens returns sum of message tokens', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]
    const total = estimateContextTokens(messages)
    const sum =
      estimateMessageTokens(messages[0]) + estimateMessageTokens(messages[1])
    expect(total).toBe(sum)
  })
})

// ---------------------------------------------------------------------------
// ContextCompactor
// ---------------------------------------------------------------------------
describe('ContextCompactor', () => {
  function makeMessages(count: number): Array<Record<string, unknown>> {
    const msgs: Array<Record<string, unknown>> = [
      { role: 'system', content: 'You are a helpful assistant.' },
    ]
    for (let i = 1; i < count; i++) {
      msgs.push({
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Message number ${i}. ${'x'.repeat(200)}`,
      })
    }
    return msgs
  }

  it('shouldCompact returns false for small message arrays', () => {
    const compactor = new ContextCompactor()
    const msgs = makeMessages(5)
    expect(compactor.shouldCompact(msgs)).toBe(false)
  })

  it('shouldCompact returns true when tokens exceed limit minus reserve', () => {
    const compactor = new ContextCompactor()
    const msgs = makeMessages(5)
    // Set a very small limit so it triggers compaction
    expect(compactor.shouldCompact(msgs, { contextLimit: 50, reserveTokens: 10 })).toBe(true)
  })

  it('findCutPoint returns value > 0 and < messages.length', () => {
    const compactor = new ContextCompactor()
    const msgs = makeMessages(20)
    const cut = compactor.findCutPoint(msgs)
    expect(cut).toBeGreaterThan(0)
    expect(cut).toBeLessThan(msgs.length)
  })

  it('findCutPoint never returns a point where messages[point].role === tool', () => {
    const compactor = new ContextCompactor()
    const msgs: Array<Record<string, unknown>> = [
      { role: 'system', content: 'System prompt.' },
    ]
    // Create a conversation with tool results interspersed
    for (let i = 0; i < 30; i++) {
      msgs.push({
        role: 'user',
        content: `User message ${i}. ${'y'.repeat(300)}`,
      })
      msgs.push({
        role: 'assistant',
        content: `Assistant response ${i}.`,
        tool_calls: [{ function: { name: 'test_tool' } }],
      })
      msgs.push({
        role: 'tool',
        tool_call_id: `call_${i}`,
        content: `Tool result ${i}. ${'z'.repeat(300)}`,
      })
    }
    const cut = compactor.findCutPoint(msgs, { keepRecentTokens: 5000 })
    expect(msgs[cut].role).not.toBe('tool')
  })

  it('serializeForSummary returns a string with role labels', () => {
    const compactor = new ContextCompactor()
    const msgs: Array<Record<string, unknown>> = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const serialized = compactor.serializeForSummary(msgs)
    expect(serialized).toContain('[user]')
    expect(serialized).toContain('[assistant]')
  })

  it('buildSummarizationPrompt includes Goal/Progress format instructions', () => {
    const compactor = new ContextCompactor()
    const prompt = compactor.buildSummarizationPrompt('some conversation text')
    expect(prompt).toContain('**Goal:**')
    expect(prompt).toContain('**Progress:**')
  })

  it('applyCompaction returns correct structure with trimmedCount and preservedCount', () => {
    const compactor = new ContextCompactor()
    const msgs = makeMessages(10)
    const cutPoint = 5

    const result = compactor.applyCompaction(msgs, 'Summary of conversation', cutPoint)

    expect(result.compacted).toBe(true)
    expect(result.trimmedCount).toBe(cutPoint - 1) // minus system message
    expect(result.preservedCount).toBe(msgs.length - cutPoint)
    expect(result.summary).toBe('Summary of conversation')
    expect(result.contextUsage).toHaveProperty('before')
    expect(result.contextUsage).toHaveProperty('after')
    expect(result.contextUsage).toHaveProperty('limit')
    // The compacted messages should include: system + summary msg + ack msg + preserved
    expect(result.messages.length).toBe(3 + result.preservedCount)
  })

  it('incremental compaction: after first applyCompaction, buildSummarizationPrompt includes "updating"', () => {
    const compactor = new ContextCompactor()
    const msgs = makeMessages(10)

    // First compaction — sets existingSummary internally
    compactor.applyCompaction(msgs, 'First summary', 5)

    // Now building a new prompt should reference the previous summary
    const prompt = compactor.buildSummarizationPrompt('more conversation text')
    expect(prompt).toContain('updating')
    expect(prompt).toContain('First summary')
  })
})

// ---------------------------------------------------------------------------
// DOM Map script builder
// ---------------------------------------------------------------------------
describe('DOM Map script builder', () => {
  it('buildDomMapScript returns a non-empty string', () => {
    const script = buildDomMapScript()
    expect(script).toBeTruthy()
    expect(script.length).toBeGreaterThan(0)
  })

  it('buildDomMapScript contains data-cf-idx', () => {
    const script = buildDomMapScript()
    expect(script).toContain('data-cf-idx')
  })

  it('buildDomMapScript with maxElements: 100 contains 100', () => {
    const script = buildDomMapScript({ maxElements: 100 })
    expect(script).toContain('100')
  })

  it('maxElements is clamped to max 1000', () => {
    const script = buildDomMapScript({ maxElements: 5000 })
    expect(script).toContain('1000')
  })

  it('maxElements is clamped to min 50', () => {
    const script = buildDomMapScript({ maxElements: 10 })
    expect(script).toContain('50')
  })
})

// ---------------------------------------------------------------------------
// Nuclear Click script builder
// ---------------------------------------------------------------------------
describe('Nuclear Click script builder', () => {
  it('buildNuclearClickScript returns a string containing the index', () => {
    const script = buildNuclearClickScript({ index: 42 })
    expect(script).toContain('42')
  })

  it('contains strategy names: pointerChain, nativeClick, elementFromPoint', () => {
    const script = buildNuclearClickScript({ index: 1 })
    expect(script).toContain('pointerChain')
    expect(script).toContain('nativeClick')
    expect(script).toContain('elementFromPoint')
  })
})

// ---------------------------------------------------------------------------
// Nuclear Type script builder
// ---------------------------------------------------------------------------
describe('Nuclear Type script builder', () => {
  it('buildNuclearTypeScript returns a string containing the text', () => {
    const script = buildNuclearTypeScript({ index: 7, text: 'hello' })
    expect(script).toContain('hello')
  })

  it('contains strategy names', () => {
    const script = buildNuclearTypeScript({ index: 1, text: 'test' })
    expect(script).toContain('keyboard')
    expect(script).toContain('execCommand')
    expect(script).toContain('inputEvent')
    expect(script).toContain('clipboard')
    expect(script).toContain('nativeSetter')
    expect(script).toContain('direct')
  })
})
