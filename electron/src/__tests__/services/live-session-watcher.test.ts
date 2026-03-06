import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('LiveSessionWatcher', () => {
  it('reads only new bytes on subsequent polls', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsw-'))
    const file = path.join(tmpDir, 'session.jsonl')

    // Write initial content
    const line1 = JSON.stringify({ type: 'user', message: { content: 'hello' }, timestamp: new Date().toISOString() })
    fs.writeFileSync(file, line1 + '\n')

    // First read: get all content
    const stat1 = fs.statSync(file)
    const content1 = fs.readFileSync(file, 'utf-8')
    expect(content1.trim()).toBe(line1)

    // Append new content
    const line2 = JSON.stringify({ type: 'assistant', message: { content: 'world' }, timestamp: new Date().toISOString() })
    fs.appendFileSync(file, line2 + '\n')

    // Second read: only new bytes
    const fd = fs.openSync(file, 'r')
    const stat2 = fs.statSync(file)
    const newBytes = Buffer.alloc(stat2.size - stat1.size)
    fs.readSync(fd, newBytes, 0, newBytes.length, stat1.size)
    fs.closeSync(fd)

    expect(newBytes.toString('utf-8').trim()).toBe(line2)

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true })
  })
})
