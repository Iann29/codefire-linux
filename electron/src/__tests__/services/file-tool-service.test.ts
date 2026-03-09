import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  FileToolService,
  resolveProjectScopedPath,
} from '../../main/services/tools/files/FileToolService'

describe('FileToolService', () => {
  let tempRoot: string
  let projectPath: string
  let service: FileToolService

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pinyino-file-tools-'))
    projectPath = path.join(tempRoot, 'project')
    service = new FileToolService()

    await fs.mkdir(path.join(projectPath, 'src', 'components'), { recursive: true })
    await fs.mkdir(path.join(projectPath, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(projectPath, 'src', 'app.ts'),
      ['const title = "Pinyino"', 'export function run() {', '  return title', '}'].join('\n'),
      'utf-8'
    )
    await fs.writeFile(
      path.join(projectPath, 'src', 'components', 'Button.tsx'),
      ['export function Button() {', '  return <button>Send</button>', '}'].join('\n'),
      'utf-8'
    )
    await fs.writeFile(
      path.join(projectPath, 'docs', 'notes.md'),
      ['# Notes', 'search token accuracy', 'browser persistence'].join('\n'),
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  describe('resolveProjectScopedPath', () => {
    it('resolves project-relative paths', () => {
      const resolved = resolveProjectScopedPath('src/app.ts', projectPath)

      expect(resolved.projectRoot).toBe(projectPath)
      expect(resolved.relativePath).toBe('src/app.ts')
      expect(resolved.resolvedPath).toBe(path.join(projectPath, 'src', 'app.ts'))
    })

    it('blocks path traversal outside the project root', () => {
      expect(() => resolveProjectScopedPath('../secrets.txt', projectPath)).toThrow(
        'Path escapes project root'
      )
    })
  })

  describe('readFile', () => {
    it('reads a project file with optional line numbers', async () => {
      const result = await service.readFile({
        projectPath,
        path: 'src/app.ts',
        includeLineNumbers: true,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        path: 'src/app.ts',
      })
      expect((result.data as { content: string }).content).toContain('1 | const title = "Pinyino"')
      expect(result.meta).toMatchObject({
        lineCount: 4,
        truncated: false,
      })
      expect(result.meta).toMatchObject({
        checksum: expect.stringMatching(/^sha256:/),
      })
    })

    it('rejects symlink targets that escape the project root', async () => {
      const outsideFile = path.join(tempRoot, 'outside.txt')
      const symlinkPath = path.join(projectPath, 'src', 'outside-link.txt')

      await fs.writeFile(outsideFile, 'do not expose', 'utf-8')
      await fs.symlink(outsideFile, symlinkPath)

      const result = await service.readFile({
        projectPath,
        path: 'src/outside-link.txt',
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('escapes project root via symlink')
    })
  })

  describe('readFileRange', () => {
    it('returns the requested line window with context', async () => {
      const result = await service.readFileRange({
        projectPath,
        path: 'src/app.ts',
        startLine: 2,
        endLine: 2,
        contextBefore: 1,
        contextAfter: 1,
      })

      expect(result.ok).toBe(true)
      expect((result.data as { content: string }).content).toContain('1 | const title = "Pinyino"')
      expect((result.data as { content: string }).content).toContain('2 | export function run() {')
      expect((result.data as { content: string }).content).toContain('3 |   return title')
      expect(result.meta).toMatchObject({
        requestedRange: { startLine: 2, endLine: 2 },
        returnedRange: { startLine: 1, endLine: 3 },
      })
    })
  })

  describe('listFiles', () => {
    it('lists project files with relative paths and filters', async () => {
      const result = await service.listFiles({
        projectPath,
        path: 'src',
        depth: 2,
        extensions: ['ts', '.tsx'],
        filesOnly: true,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        entries: expect.arrayContaining([
          expect.objectContaining({ path: 'src/app.ts', kind: 'file' }),
          expect.objectContaining({ path: 'src/components/Button.tsx', kind: 'file' }),
        ]),
      })
      expect(result.meta).toMatchObject({
        basePath: 'src',
      })
    })
  })

  describe('globFiles and grepFiles', () => {
    it('finds files by glob pattern', async () => {
      const result = await service.globFiles({
        projectPath,
        pattern: 'src/**/*.{ts,tsx}',
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        matches: expect.arrayContaining([
          expect.objectContaining({ path: 'src/app.ts' }),
          expect.objectContaining({ path: 'src/components/Button.tsx' }),
        ]),
      })
    })

    it('searches text with contextual hits', async () => {
      const result = await service.grepFiles({
        projectPath,
        query: 'title',
        extensions: ['ts'],
        contextLines: 1,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        hits: [
          expect.objectContaining({
            path: 'src/app.ts',
            line: 1,
            match: 'title',
          }),
          expect.objectContaining({
            path: 'src/app.ts',
            line: 3,
            match: 'title',
          }),
        ],
      })
      expect(result.meta).toMatchObject({
        scannedFiles: 1,
      })
    })
  })

  describe('safe editing', () => {
    it('creates a new file by default when the target does not exist', async () => {
      const result = await service.writeFile({
        projectPath,
        path: 'src/default-create.ts',
        content: 'export const created = true\n',
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        path: 'src/default-create.ts',
        operation: 'created',
        applied: true,
      })

      const written = await fs.readFile(path.join(projectPath, 'src', 'default-create.ts'), 'utf-8')
      expect(written).toBe('export const created = true\n')
    })

    it('creates a new file when createIfMissing is enabled', async () => {
      const result = await service.writeFile({
        projectPath,
        path: 'src/new-file.ts',
        content: 'export const value = 1\n',
        createIfMissing: true,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        path: 'src/new-file.ts',
        operation: 'created',
        applied: true,
      })

      const written = await fs.readFile(path.join(projectPath, 'src', 'new-file.ts'), 'utf-8')
      expect(written).toBe('export const value = 1\n')
    })

    it('rejects overwriting an existing file without expected checksum', async () => {
      const result = await service.writeFile({
        projectPath,
        path: 'src/app.ts',
        content: 'changed',
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('expectedChecksum is required')
    })

    it('applies a guarded patch with exact replacement counts', async () => {
      const readResult = await service.readFile({
        projectPath,
        path: 'src/app.ts',
      })
      const checksum = (readResult.meta as { checksum: string }).checksum

      const result = await service.applyFilePatch({
        projectPath,
        path: 'src/app.ts',
        expectedChecksum: checksum,
        operations: [
          {
            find: 'return title',
            replace: 'return `${title}!`',
          },
        ],
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        path: 'src/app.ts',
        applied: true,
        operationCount: 1,
      })

      const written = await fs.readFile(path.join(projectPath, 'src', 'app.ts'), 'utf-8')
      expect(written).toContain('return `${title}!`')
    })

    it('rejects stale checksum during patching', async () => {
      const result = await service.applyFilePatch({
        projectPath,
        path: 'src/app.ts',
        expectedChecksum: 'sha256:stale',
        operations: [
          {
            find: 'return title',
            replace: 'return title.toUpperCase()',
          },
        ],
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Checksum mismatch')
    })

    it('moves a file within the project', async () => {
      const result = await service.movePath({
        projectPath,
        from: 'docs/notes.md',
        to: 'docs/archive/notes.md',
      })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        applied: true,
        from: 'docs/notes.md',
        to: 'docs/archive/notes.md',
        kind: 'file',
      })

      await expect(fs.access(path.join(projectPath, 'docs', 'archive', 'notes.md'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(projectPath, 'docs', 'notes.md'))).rejects.toThrow()
    })
  })
})
