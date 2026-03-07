import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentMetrics } from '../../main/services/AgentMetrics'
import { ContextCompactor } from '../../main/services/ContextCompactor'
import {
  DESTRUCTIVE_BROWSER_TOOLS,
  URL_BEARING_TOOLS,
  DEFAULT_BLOCKED_DOMAINS,
  validateBrowserUrl,
} from '../../main/services/AgentService'

// ---------------------------------------------------------------------------
// AgentMetrics — unit tests
// ---------------------------------------------------------------------------
describe('AgentMetrics', () => {
  let metrics: AgentMetrics

  beforeEach(() => {
    metrics = new AgentMetrics()
  })

  describe('recordToolCall', () => {
    it('registers latency correctly', () => {
      metrics.recordToolCall('browser_navigate', 150, 'done')
      metrics.recordToolCall('browser_navigate', 250, 'done')

      const stats = metrics.getToolStats()
      expect(stats['browser_navigate']).toBeDefined()
      expect(stats['browser_navigate'].count).toBe(2)
      expect(stats['browser_navigate'].avgMs).toBe(200)
      expect(stats['browser_navigate'].minMs).toBe(150)
      expect(stats['browser_navigate'].maxMs).toBe(250)
    })

    it('registers errors correctly', () => {
      metrics.recordToolCall('browser_click', 100, 'done')
      metrics.recordToolCall('browser_click', 200, 'error')
      metrics.recordToolCall('browser_click', 50, 'error')

      const stats = metrics.getToolStats()
      expect(stats['browser_click'].errorCount).toBe(2)
      expect(stats['browser_click'].count).toBe(3)
    })

    it('registers timeouts correctly', () => {
      metrics.recordToolCall('browser_screenshot', 30000, 'timeout')
      metrics.recordToolCall('browser_screenshot', 100, 'done')

      const stats = metrics.getToolStats()
      expect(stats['browser_screenshot'].timeoutCount).toBe(1)
      expect(stats['browser_screenshot'].count).toBe(2)
    })

    it('tracks multiple tool names independently', () => {
      metrics.recordToolCall('tool_a', 100, 'done')
      metrics.recordToolCall('tool_b', 200, 'error')

      const stats = metrics.getToolStats()
      expect(Object.keys(stats)).toHaveLength(2)
      expect(stats['tool_a'].count).toBe(1)
      expect(stats['tool_a'].errorCount).toBe(0)
      expect(stats['tool_b'].count).toBe(1)
      expect(stats['tool_b'].errorCount).toBe(1)
    })
  })

  describe('recordRunStart / recordRunEnd', () => {
    it('tracks a completed run', () => {
      metrics.recordRunStart()
      metrics.recordToolCall('tool_a', 50, 'done')
      metrics.recordToolCall('tool_b', 75, 'done')
      metrics.recordRunEnd()

      const runStats = metrics.getRunStats()
      expect(runStats.totalRuns).toBe(1)
      expect(runStats.avgToolCallsPerRun).toBe(2)
      expect(runStats.avgDurationMs).toBeGreaterThanOrEqual(0)
    })

    it('ignores recordRunEnd without a prior recordRunStart', () => {
      metrics.recordRunEnd()

      const runStats = metrics.getRunStats()
      expect(runStats.totalRuns).toBe(0)
    })

    it('tracks multiple runs correctly', () => {
      for (let i = 0; i < 5; i++) {
        metrics.recordRunStart()
        metrics.recordToolCall('tool', 10, 'done')
        metrics.recordRunEnd()
      }

      const runStats = metrics.getRunStats()
      expect(runStats.totalRuns).toBe(5)
      expect(runStats.avgToolCallsPerRun).toBe(1)
    })
  })

  describe('getToolStats', () => {
    it('returns empty object when no calls recorded', () => {
      expect(metrics.getToolStats()).toEqual({})
    })

    it('returns correct avg/min/max for a single call', () => {
      metrics.recordToolCall('single', 500, 'done')

      const stats = metrics.getToolStats()
      expect(stats['single'].avgMs).toBe(500)
      expect(stats['single'].minMs).toBe(500)
      expect(stats['single'].maxMs).toBe(500)
    })

    it('computes avgMs as rounded integer', () => {
      metrics.recordToolCall('t', 100, 'done')
      metrics.recordToolCall('t', 101, 'done')
      metrics.recordToolCall('t', 102, 'done')

      const stats = metrics.getToolStats()
      // (100 + 101 + 102) / 3 = 101
      expect(stats['t'].avgMs).toBe(101)
    })

    it('reports minMs as 0 when no calls exist (edge: via reset)', () => {
      metrics.recordToolCall('x', 50, 'done')
      metrics.reset()

      const stats = metrics.getToolStats()
      expect(Object.keys(stats)).toHaveLength(0)
    })
  })

  describe('getRunStats', () => {
    it('returns zeros when no runs recorded', () => {
      const stats = metrics.getRunStats()
      expect(stats).toEqual({
        totalRuns: 0,
        avgDurationMs: 0,
        avgToolCallsPerRun: 0,
      })
    })

    it('returns correct totalRuns, avgDurationMs, avgToolCallsPerRun', () => {
      // Simulate two runs using mocked Date.now for predictable durations
      const originalNow = Date.now
      let fakeTime = 1000

      Date.now = vi.fn(() => fakeTime)

      metrics.recordRunStart() // start at 1000
      metrics.recordToolCall('a', 10, 'done')
      metrics.recordToolCall('b', 20, 'done')
      fakeTime = 1500
      metrics.recordRunEnd() // end at 1500, duration = 500ms, 2 tool calls

      metrics.recordRunStart() // start at 1500
      metrics.recordToolCall('c', 5, 'done')
      fakeTime = 1800
      metrics.recordRunEnd() // end at 1800, duration = 300ms, 1 tool call

      const stats = metrics.getRunStats()
      expect(stats.totalRuns).toBe(2)
      expect(stats.avgDurationMs).toBe(400) // (500+300)/2
      expect(stats.avgToolCallsPerRun).toBe(1.5) // (2+1)/2

      Date.now = originalNow
    })
  })

  describe('reset', () => {
    it('clears all tool stats and run records', () => {
      metrics.recordToolCall('tool', 100, 'done')
      metrics.recordRunStart()
      metrics.recordRunEnd()

      metrics.reset()

      expect(metrics.getToolStats()).toEqual({})
      expect(metrics.getRunStats()).toEqual({
        totalRuns: 0,
        avgDurationMs: 0,
        avgToolCallsPerRun: 0,
      })
    })

    it('clears in-progress run state', () => {
      metrics.recordRunStart()
      metrics.recordToolCall('tool', 50, 'done')
      metrics.reset()

      // After reset, recordRunEnd should do nothing (no currentRunStart)
      metrics.recordRunEnd()
      expect(metrics.getRunStats().totalRuns).toBe(0)
    })
  })

  describe('toJSON', () => {
    it('returns a serializable snapshot', () => {
      metrics.recordToolCall('nav', 200, 'done')
      metrics.recordRunStart()
      metrics.recordRunEnd()

      const json = metrics.toJSON()
      // Must be JSON-serializable
      const parsed = JSON.parse(JSON.stringify(json))
      expect(parsed).toHaveProperty('tools')
      expect(parsed).toHaveProperty('runs')
      expect(parsed.tools).toHaveProperty('nav')
      expect(parsed.runs.totalRuns).toBe(1)
    })

    it('returns valid JSON even with no data', () => {
      const json = metrics.toJSON()
      const str = JSON.stringify(json)
      expect(() => JSON.parse(str)).not.toThrow()
    })
  })

  describe('MAX_RUNS cap', () => {
    it('keeps only the last 100 runs and discards older ones', () => {
      for (let i = 0; i < 120; i++) {
        metrics.recordRunStart()
        metrics.recordRunEnd()
      }

      const stats = metrics.getRunStats()
      expect(stats.totalRuns).toBe(100)
    })

    it('retains the most recent runs (not the oldest)', () => {
      const originalNow = Date.now
      let fakeTime = 0

      Date.now = vi.fn(() => fakeTime)

      // Record 105 runs with increasing durations
      for (let i = 1; i <= 105; i++) {
        fakeTime = i * 1000
        metrics.recordRunStart()
        fakeTime = i * 1000 + i // duration = i ms
        metrics.recordRunEnd()
      }

      const stats = metrics.getRunStats()
      expect(stats.totalRuns).toBe(100)
      // Oldest 5 runs (durations 1-5) should be discarded
      // Remaining runs have durations 6-105
      // Sum = 6+7+...+105 = sum(1..105) - sum(1..5) = 5565 - 15 = 5550
      // avg = 5550/100 = 55.5 -> rounds to 56 (Math.round)
      expect(stats.avgDurationMs).toBe(56)

      Date.now = originalNow
    })
  })
})

// ---------------------------------------------------------------------------
// Domain Security — validateBrowserUrl
// ---------------------------------------------------------------------------
describe('Domain Security — validateBrowserUrl', () => {
  describe('blocked domains', () => {
    it('blocks localhost', () => {
      const result = validateBrowserUrl('http://localhost:3000/page')
      expect(result).not.toBeNull()
      expect(result).toContain('blocked')
    })

    it('blocks 127.0.0.1', () => {
      const result = validateBrowserUrl('http://127.0.0.1:8080/')
      expect(result).not.toBeNull()
      expect(result).toContain('blocked')
    })

    it('blocks 0.0.0.0', () => {
      const result = validateBrowserUrl('http://0.0.0.0/')
      expect(result).not.toBeNull()
    })

    it('blocks paypal.com', () => {
      const result = validateBrowserUrl('https://paypal.com/checkout')
      expect(result).not.toBeNull()
      expect(result).toContain('blocked')
    })

    it('blocks stripe.com', () => {
      const result = validateBrowserUrl('https://stripe.com/dashboard')
      expect(result).not.toBeNull()
    })

    it('blocks chase.com', () => {
      const result = validateBrowserUrl('https://chase.com/login')
      expect(result).not.toBeNull()
    })

    it('blocks subdomain of blocked domain (e.g. www.paypal.com)', () => {
      const result = validateBrowserUrl('https://www.paypal.com/checkout')
      expect(result).not.toBeNull()
      expect(result).toContain('blocked')
    })

    it('blocks domains starting with blocked prefix (e.g. banking.example.com)', () => {
      const result = validateBrowserUrl('https://banking.example.com/accounts')
      expect(result).not.toBeNull()
    })

    it('blocks admin. prefix domains', () => {
      const result = validateBrowserUrl('https://admin.mysite.com/')
      expect(result).not.toBeNull()
    })

    it('blocks cloud provider consoles', () => {
      expect(validateBrowserUrl('https://console.aws.amazon.com/s3')).not.toBeNull()
      expect(validateBrowserUrl('https://portal.azure.com/')).not.toBeNull()
      expect(validateBrowserUrl('https://console.cloud.google.com/')).not.toBeNull()
    })

    it('blocks mail.google.com', () => {
      const result = validateBrowserUrl('https://mail.google.com/mail/u/0/')
      expect(result).not.toBeNull()
    })
  })

  describe('allowed domains', () => {
    it('allows normal website URLs', () => {
      const result = validateBrowserUrl('https://example.com/page')
      expect(result).toBeNull()
    })

    it('allows github.com', () => {
      const result = validateBrowserUrl('https://github.com/some/repo')
      expect(result).toBeNull()
    })

    it('allows stackoverflow.com', () => {
      const result = validateBrowserUrl('https://stackoverflow.com/questions')
      expect(result).toBeNull()
    })

    it('allows wikipedia.org', () => {
      const result = validateBrowserUrl('https://en.wikipedia.org/wiki/Test')
      expect(result).toBeNull()
    })

    it('allows docs.google.com (not in blocklist)', () => {
      const result = validateBrowserUrl('https://docs.google.com/document')
      expect(result).toBeNull()
    })
  })

  describe('invalid URLs', () => {
    it('rejects malformed URLs', () => {
      const result = validateBrowserUrl('not-a-url')
      expect(result).not.toBeNull()
      expect(result).toContain('Invalid URL')
    })

    it('rejects empty string', () => {
      const result = validateBrowserUrl('')
      expect(result).not.toBeNull()
      expect(result).toContain('Invalid URL')
    })
  })

  describe('allowlist enforcement', () => {
    it('when allowedDomains is set, blocks domains not in the list', () => {
      const result = validateBrowserUrl(
        'https://example.com/',
        [], // no blocklist
        ['github.com', 'docs.google.com']
      )
      expect(result).not.toBeNull()
      expect(result).toContain('not in the allowed domains list')
    })

    it('when allowedDomains is set, allows domains in the list', () => {
      const result = validateBrowserUrl(
        'https://github.com/repo',
        [], // no blocklist
        ['github.com']
      )
      expect(result).toBeNull()
    })

    it('allowlist matches subdomains', () => {
      const result = validateBrowserUrl(
        'https://api.github.com/endpoint',
        [],
        ['github.com']
      )
      expect(result).toBeNull()
    })

    it('blocklist takes priority over allowlist', () => {
      const result = validateBrowserUrl(
        'https://localhost:3000/',
        DEFAULT_BLOCKED_DOMAINS,
        ['localhost']
      )
      // blocklist check runs first, so it's blocked
      expect(result).not.toBeNull()
      expect(result).toContain('blocked')
    })

    it('empty allowedDomains array means no allowlist restriction', () => {
      const result = validateBrowserUrl('https://random-site.com/', [], [])
      expect(result).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// ContextCompactor — extended integration tests
// ---------------------------------------------------------------------------
describe('ContextCompactor — integration', () => {
  function makeMessages(count: number): Array<Record<string, unknown>> {
    const msgs: Array<Record<string, unknown>> = [
      { role: 'system', content: 'You are a helpful browser assistant.' },
    ]
    for (let i = 1; i < count; i++) {
      msgs.push({
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Message number ${i}. ${'x'.repeat(200)}`,
      })
    }
    return msgs
  }

  function makeToolConversation(toolSets: number): Array<Record<string, unknown>> {
    const msgs: Array<Record<string, unknown>> = [
      { role: 'system', content: 'System prompt with instructions.' },
    ]
    for (let i = 0; i < toolSets; i++) {
      msgs.push({ role: 'user', content: `User request ${i}. ${'a'.repeat(300)}` })
      msgs.push({
        role: 'assistant',
        content: `Calling tool for request ${i}.`,
        tool_calls: [{ id: `call_${i}`, function: { name: `tool_${i}` } }],
      })
      msgs.push({
        role: 'tool',
        tool_call_id: `call_${i}`,
        content: `Result for request ${i}. ${'b'.repeat(300)}`,
      })
    }
    return msgs
  }

  describe('full compaction flow', () => {
    it('shouldCompact -> findCutPoint -> serializeForSummary -> buildSummarizationPrompt -> applyCompaction', () => {
      const compactor = new ContextCompactor()
      // Use enough messages and small keepRecentTokens to guarantee a meaningful cut
      const msgs = makeMessages(50)

      // Step 1: shouldCompact — force it with low limit
      expect(compactor.shouldCompact(msgs, { contextLimit: 100, reserveTokens: 10 })).toBe(true)

      // Step 2: findCutPoint with low keepRecentTokens so cut is well into the messages
      const cutPoint = compactor.findCutPoint(msgs, { keepRecentTokens: 2000 })
      expect(cutPoint).toBeGreaterThan(1)
      expect(cutPoint).toBeLessThan(msgs.length)

      // Step 3: serializeForSummary (messages to be trimmed = 1..cutPoint)
      const toSummarize = msgs.slice(1, cutPoint)
      const serialized = compactor.serializeForSummary(toSummarize)
      expect(serialized.length).toBeGreaterThan(0)
      expect(serialized).toContain('[user]')

      // Step 4: buildSummarizationPrompt
      const prompt = compactor.buildSummarizationPrompt(serialized)
      expect(prompt).toContain('**Goal:**')
      expect(prompt).toContain('**Progress:**')

      // Step 5: applyCompaction
      const result = compactor.applyCompaction(msgs, 'Summary of the conversation so far.', cutPoint)
      expect(result.compacted).toBe(true)
      expect(result.trimmedCount).toBe(cutPoint - 1)
      expect(result.preservedCount).toBe(msgs.length - cutPoint)
      expect(result.messages.length).toBe(3 + result.preservedCount)
      expect(result.contextUsage.after).toBeLessThan(result.contextUsage.before)
    })
  })

  describe('tool message integrity', () => {
    it('findCutPoint never lands on a tool message', () => {
      const compactor = new ContextCompactor()
      const msgs = makeToolConversation(30)

      const cutPoint = compactor.findCutPoint(msgs, { keepRecentTokens: 5000 })
      expect(msgs[cutPoint].role).not.toBe('tool')
    })

    it('findCutPoint avoids splitting assistant+tool pairs', () => {
      const compactor = new ContextCompactor()
      const msgs = makeToolConversation(20)

      // Test with several different keepRecentTokens values
      for (const keepRecent of [2000, 5000, 10000, 15000]) {
        const cutPoint = compactor.findCutPoint(msgs, { keepRecentTokens: keepRecent })
        expect(msgs[cutPoint].role).not.toBe('tool')
      }
    })

    it('serialization handles tool messages with role labels', () => {
      const compactor = new ContextCompactor()
      const msgs: Array<Record<string, unknown>> = [
        {
          role: 'assistant',
          content: 'Let me click that.',
          tool_calls: [{ id: 'call_1', function: { name: 'browser_click' } }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: 'Click succeeded.',
        },
      ]

      const serialized = compactor.serializeForSummary(msgs)
      expect(serialized).toContain('Tool Result call_1')
      expect(serialized).toContain('browser_click')
    })
  })

  describe('incremental compaction', () => {
    it('second compaction includes previous summary in prompt', () => {
      const compactor = new ContextCompactor()
      const msgs1 = makeMessages(15)

      // First compaction
      const cut1 = compactor.findCutPoint(msgs1)
      compactor.applyCompaction(msgs1, 'First summary: user asked for help with X.', cut1)

      // After first compaction, buildSummarizationPrompt should reference existing summary
      const prompt = compactor.buildSummarizationPrompt('new conversation text')
      expect(prompt).toContain('updating')
      expect(prompt).toContain('First summary: user asked for help with X.')
    })

    it('two sequential compactions produce valid results', () => {
      const compactor = new ContextCompactor()

      // First run — use many large messages so cut is meaningful
      const msgs1 = makeMessages(40)
      const cut1 = compactor.findCutPoint(msgs1, { keepRecentTokens: 2000 })
      const result1 = compactor.applyCompaction(msgs1, 'Summary after round 1.', cut1)
      expect(result1.compacted).toBe(true)

      // Simulate continued conversation on compacted messages
      const continued = [...result1.messages]
      for (let i = 0; i < 30; i++) {
        continued.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Extended message ${i}. ${'y'.repeat(300)}`,
        })
      }

      // Second compaction — use small keepRecentTokens to ensure meaningful trimming
      const cut2 = compactor.findCutPoint(continued, { keepRecentTokens: 2000 })
      const result2 = compactor.applyCompaction(continued, 'Updated summary after round 2.', cut2)
      expect(result2.compacted).toBe(true)
      expect(result2.messages.length).toBeGreaterThan(3) // system + summary + ack + preserved
      // Verify that trimming removed a meaningful number of messages
      expect(result2.trimmedCount).toBeGreaterThan(0)
      expect(result2.preservedCount).toBeGreaterThan(0)
    })
  })

  describe('applyCompaction structure', () => {
    it('first message is always the original system message', () => {
      const compactor = new ContextCompactor()
      const msgs = makeMessages(10)
      const result = compactor.applyCompaction(msgs, 'A summary.', 5)

      expect(result.messages[0]).toBe(msgs[0])
      expect(result.messages[0].role).toBe('system')
    })

    it('second message is the compaction summary (user role)', () => {
      const compactor = new ContextCompactor()
      const msgs = makeMessages(10)
      const result = compactor.applyCompaction(msgs, 'The summary text.', 5)

      expect(result.messages[1].role).toBe('user')
      expect(result.messages[1].content).toContain('CONTEXT COMPACTION')
      expect(result.messages[1].content).toContain('The summary text.')
    })

    it('third message is the assistant acknowledgment', () => {
      const compactor = new ContextCompactor()
      const msgs = makeMessages(10)
      const result = compactor.applyCompaction(msgs, 'Sum.', 5)

      expect(result.messages[2].role).toBe('assistant')
      expect(result.messages[2].content).toContain('Understood')
    })

    it('remaining messages match the preserved slice from original', () => {
      const compactor = new ContextCompactor()
      const msgs = makeMessages(10)
      const cutPoint = 5
      const result = compactor.applyCompaction(msgs, 'Sum.', cutPoint)

      const preserved = msgs.slice(cutPoint)
      for (let i = 0; i < preserved.length; i++) {
        expect(result.messages[3 + i]).toBe(preserved[i])
      }
    })
  })
})

// ---------------------------------------------------------------------------
// AgentService constants — sanity checks
// ---------------------------------------------------------------------------
describe('AgentService constants', () => {
  describe('DESTRUCTIVE_BROWSER_TOOLS', () => {
    it('contains exactly the 4 expected destructive tools', () => {
      expect(DESTRUCTIVE_BROWSER_TOOLS.size).toBe(4)
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_nuclear_click')).toBe(true)
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_nuclear_type')).toBe(true)
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_fill_form')).toBe(true)
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_drag_and_drop')).toBe(true)
    })

    it('does not contain non-destructive tools', () => {
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_navigate')).toBe(false)
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_screenshot')).toBe(false)
      expect(DESTRUCTIVE_BROWSER_TOOLS.has('browser_dom_map')).toBe(false)
    })
  })

  describe('URL_BEARING_TOOLS', () => {
    it('contains browser_navigate and browser_open_tab', () => {
      expect(URL_BEARING_TOOLS.has('browser_navigate')).toBe(true)
      expect(URL_BEARING_TOOLS.has('browser_open_tab')).toBe(true)
    })

    it('has exactly 2 entries', () => {
      expect(URL_BEARING_TOOLS.size).toBe(2)
    })
  })

  describe('DEFAULT_BLOCKED_DOMAINS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(DEFAULT_BLOCKED_DOMAINS)).toBe(true)
      expect(DEFAULT_BLOCKED_DOMAINS.length).toBeGreaterThan(0)
    })

    it('contains localhost', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('localhost')
    })

    it('contains paypal.com', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('paypal.com')
    })

    it('contains stripe.com', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('stripe.com')
    })

    it('contains chase.com', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('chase.com')
    })

    it('contains 127.0.0.1 and 0.0.0.0', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('127.0.0.1')
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('0.0.0.0')
    })

    it('contains banking-related prefix entries', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('banking.')
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('bank.')
    })

    it('contains cloud provider consoles', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('console.aws.amazon.com')
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('portal.azure.com')
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('console.cloud.google.com')
    })
  })
})
