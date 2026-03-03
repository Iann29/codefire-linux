import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { resolvePath } from '../../main/services/ProjectDiscovery'

// ─── Mock fs for controlled testing ─────────────────────────────────────────

// We partially mock fs — only statSync is mocked for path resolution tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    statSync: vi.fn(),
    readdirSync: actual.readdirSync,
  }
})

const mockedStatSync = vi.mocked(fs.statSync)

describe('ProjectDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolvePath', () => {
    it('resolves a simple path with no ambiguity', () => {
      // Path: /Users/nick/project
      // Encoded: -Users-nick-project

      mockedStatSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString()
        const existingDirs = ['/Users', '/Users/nick', '/Users/nick/project']
        if (existingDirs.includes(pathStr)) {
          return { isDirectory: () => true } as fs.Stats
        }
        throw new Error('ENOENT')
      })

      const result = resolvePath('-Users-nick-project')
      expect(result).toBe('/Users/nick/project')
    })

    it('resolves a path with dashes in directory names', () => {
      // Path: /Users/nick/my-project
      // Encoded: -Users-nick-my-project

      mockedStatSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString()
        const existingDirs = ['/Users', '/Users/nick', '/Users/nick/my-project']
        if (existingDirs.includes(pathStr)) {
          return { isDirectory: () => true } as fs.Stats
        }
        throw new Error('ENOENT')
      })

      const result = resolvePath('-Users-nick-my-project')
      expect(result).toBe('/Users/nick/my-project')
    })

    it('resolves a path with dots in directory names', () => {
      // Path: /Users/nick/.config
      // Encoded: -Users-nick--config

      mockedStatSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString()
        const existingDirs = ['/Users', '/Users/nick', '/Users/nick/.config']
        if (existingDirs.includes(pathStr)) {
          return { isDirectory: () => true } as fs.Stats
        }
        throw new Error('ENOENT')
      })

      const result = resolvePath('-Users-nick--config')
      expect(result).toBe('/Users/nick/.config')
    })

    it('resolves a path with spaces in directory names', () => {
      // Path: /Users/nick/my project
      // Encoded: -Users-nick-my-project

      // This is ambiguous with dashes — the filesystem determines which wins.
      // We set up the filesystem so only the space version exists.
      mockedStatSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString()
        const existingDirs = ['/Users', '/Users/nick', '/Users/nick/my project']
        if (existingDirs.includes(pathStr)) {
          return { isDirectory: () => true } as fs.Stats
        }
        throw new Error('ENOENT')
      })

      const result = resolvePath('-Users-nick-my-project')
      expect(result).toBe('/Users/nick/my project')
    })

    it('returns null for the bare `-` directory', () => {
      const result = resolvePath('-')
      expect(result).toBeNull()
    })

    it('returns null when no valid path can be resolved', () => {
      mockedStatSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const result = resolvePath('-nonexistent-path-here')
      expect(result).toBeNull()
    })

    it('returns null for strings that do not start with `-`', () => {
      const result = resolvePath('Users-nick-project')
      expect(result).toBeNull()
    })

    it('handles deep nested paths', () => {
      // Path: /Users/nick/Documents/projects/my-app
      // Encoded: -Users-nick-Documents-projects-my-app

      mockedStatSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString()
        const existingDirs = [
          '/Users',
          '/Users/nick',
          '/Users/nick/Documents',
          '/Users/nick/Documents/projects',
          '/Users/nick/Documents/projects/my-app',
        ]
        if (existingDirs.includes(pathStr)) {
          return { isDirectory: () => true } as fs.Stats
        }
        throw new Error('ENOENT')
      })

      const result = resolvePath('-Users-nick-Documents-projects-my-app')
      expect(result).toBe('/Users/nick/Documents/projects/my-app')
    })

    it('respects timeout on complex encodings', () => {
      // Provide a very short timeout and a path that cannot resolve
      mockedStatSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const start = Date.now()
      const result = resolvePath(
        '-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z',
        50
      )
      const elapsed = Date.now() - start

      expect(result).toBeNull()
      // Should complete within a reasonable margin of the timeout
      expect(elapsed).toBeLessThan(200)
    })

    it('resolves real-world Claude project encoding pattern', () => {
      // Path: /Users/nicknorris/Documents/claude-code-projects/claude-context-tool
      // Encoded: -Users-nicknorris-Documents-claude-code-projects-claude-context-tool

      mockedStatSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString()
        const existingDirs = [
          '/Users',
          '/Users/nicknorris',
          '/Users/nicknorris/Documents',
          '/Users/nicknorris/Documents/claude-code-projects',
          '/Users/nicknorris/Documents/claude-code-projects/claude-context-tool',
        ]
        if (existingDirs.includes(pathStr)) {
          return { isDirectory: () => true } as fs.Stats
        }
        throw new Error('ENOENT')
      })

      const result = resolvePath(
        '-Users-nicknorris-Documents-claude-code-projects-claude-context-tool'
      )
      expect(result).toBe(
        '/Users/nicknorris/Documents/claude-code-projects/claude-context-tool'
      )
    })
  })
})
