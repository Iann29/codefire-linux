import path from 'path'
import os from 'os'
import fs from 'fs'

export function getDatabasePath(): string {
  const dir = path.join(os.homedir(), '.config', 'CodeFire')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'codefire.db')
}
