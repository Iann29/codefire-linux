import { describe, it, expect } from 'vitest'
import { parseSessionFile, type ParsedSession } from '../../main/services/SessionParser'

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonl(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

function makeUserMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'user',
    sessionId: 'test-session-id',
    timestamp: '2026-01-15T10:00:00.000Z',
    message: {
      role: 'user',
      content: 'Hello',
    },
    ...overrides,
  }
}

function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    sessionId: 'test-session-id',
    timestamp: '2026-01-15T10:01:00.000Z',
    message: {
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello back!' }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      },
    },
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SessionParser', () => {
  describe('parseSessionFile', () => {
    it('parses a minimal JSONL with user + assistant messages', () => {
      const content = jsonl(makeUserMessage(), makeAssistantMessage())
      const result = parseSessionFile(content, 'abc-123')

      expect(result.sessionId).toBe('abc-123')
      expect(result.messageCount).toBe(2)
      expect(result.model).toBe('claude-sonnet-4-6')
    })

    it('extracts token counts correctly', () => {
      const content = jsonl(
        makeUserMessage(),
        makeAssistantMessage(),
        makeAssistantMessage({
          timestamp: '2026-01-15T10:02:00.000Z',
          message: {
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [{ type: 'text', text: 'More text' }],
            usage: {
              input_tokens: 150,
              output_tokens: 75,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 50,
            },
          },
        })
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.inputTokens).toBe(250) // 100 + 150
      expect(result.outputTokens).toBe(125) // 50 + 75
      expect(result.cacheCreationTokens).toBe(300) // 200 + 100
      expect(result.cacheReadTokens).toBe(350) // 300 + 50
    })

    it('handles missing fields gracefully', () => {
      const content = jsonl(
        { type: 'user', message: { role: 'user', content: 'hi' } },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hello' }],
            // no usage, no model
          },
        }
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.sessionId).toBe('abc-123')
      expect(result.slug).toBeNull()
      expect(result.model).toBeNull()
      expect(result.gitBranch).toBeNull()
      expect(result.startedAt).toBeNull()
      expect(result.endedAt).toBeNull()
      expect(result.messageCount).toBe(2)
      expect(result.inputTokens).toBe(0)
      expect(result.outputTokens).toBe(0)
      expect(result.cacheCreationTokens).toBe(0)
      expect(result.cacheReadTokens).toBe(0)
    })

    it('extracts file paths from tool_use blocks', () => {
      const content = jsonl(
        makeUserMessage(),
        {
          type: 'assistant',
          timestamp: '2026-01-15T10:01:00.000Z',
          message: {
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Read',
                input: { file_path: '/Users/test/project/src/index.ts' },
              },
              {
                type: 'tool_use',
                id: 'tool-2',
                name: 'Edit',
                input: { file_path: '/Users/test/project/src/app.ts' },
              },
              {
                type: 'tool_use',
                id: 'tool-3',
                name: 'Read',
                input: { file_path: '/Users/test/project/src/index.ts' }, // duplicate
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.toolUseCount).toBe(3)
      expect(result.filesChanged).toHaveLength(2) // deduped
      expect(result.filesChanged).toContain('/Users/test/project/src/index.ts')
      expect(result.filesChanged).toContain('/Users/test/project/src/app.ts')
    })

    it('handles empty/malformed lines', () => {
      const content = [
        '',
        '   ',
        'this is not valid json',
        JSON.stringify(makeUserMessage()),
        '{broken json',
        JSON.stringify(makeAssistantMessage()),
        '',
      ].join('\n')

      const result = parseSessionFile(content, 'abc-123')

      expect(result.messageCount).toBe(2)
      expect(result.inputTokens).toBe(100)
    })

    it('parses timestamps correctly and finds start/end', () => {
      const content = jsonl(
        makeUserMessage({ timestamp: '2026-01-15T10:00:00.000Z' }),
        makeAssistantMessage({ timestamp: '2026-01-15T10:01:30.500Z' }),
        makeUserMessage({ timestamp: '2026-01-15T10:05:00.000Z' }),
        makeAssistantMessage({ timestamp: '2026-01-15T10:06:00.000Z' })
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.startedAt).toBe('2026-01-15T10:00:00.000Z')
      expect(result.endedAt).toBe('2026-01-15T10:06:00.000Z')
    })

    it('extracts slug from any line', () => {
      const content = jsonl(
        { type: 'progress', data: { type: 'hook_progress' }, timestamp: '2026-01-15T10:00:00.000Z' },
        makeUserMessage({ slug: 'lexical-finding-mango' })
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.slug).toBe('lexical-finding-mango')
    })

    it('extracts gitBranch from any line', () => {
      const content = jsonl(
        makeUserMessage({ gitBranch: 'feature/auth' }),
        makeAssistantMessage()
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.gitBranch).toBe('feature/auth')
    })

    it('skips progress and file-history-snapshot types', () => {
      const content = jsonl(
        { type: 'progress', data: { type: 'hook_progress' }, timestamp: '2026-01-15T09:59:00.000Z' },
        { type: 'file-history-snapshot', messageId: 'abc', snapshot: {} },
        makeUserMessage(),
        makeAssistantMessage()
      )
      const result = parseSessionFile(content, 'abc-123')

      // Only user + assistant counted as messages
      expect(result.messageCount).toBe(2)
      // But progress timestamp still contributes to startedAt
      expect(result.startedAt).toBe('2026-01-15T09:59:00.000Z')
    })

    it('handles tool_use blocks without file_path input', () => {
      const content = jsonl(
        makeUserMessage(),
        {
          type: 'assistant',
          timestamp: '2026-01-15T10:01:00.000Z',
          message: {
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Bash',
                input: { command: 'ls -la' },
              },
              {
                type: 'tool_use',
                id: 'tool-2',
                name: 'WebSearch',
                input: { query: 'something' },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.toolUseCount).toBe(2)
      expect(result.filesChanged).toHaveLength(0)
    })

    it('handles empty content string', () => {
      const result = parseSessionFile('', 'abc-123')

      expect(result.sessionId).toBe('abc-123')
      expect(result.messageCount).toBe(0)
      expect(result.inputTokens).toBe(0)
    })

    it('extracts the first model found', () => {
      const content = jsonl(
        makeUserMessage(),
        makeAssistantMessage({
          message: {
            model: 'claude-opus-4-6',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
        makeAssistantMessage({
          message: {
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        })
      )
      const result = parseSessionFile(content, 'abc-123')

      expect(result.model).toBe('claude-opus-4-6')
    })

    it('handles user message with string content', () => {
      const content = jsonl({
        type: 'user',
        timestamp: '2026-01-15T10:00:00.000Z',
        message: {
          role: 'user',
          content: 'simple string content',
        },
      })
      const result = parseSessionFile(content, 'abc-123')

      expect(result.messageCount).toBe(1)
    })
  })
})
