import path from 'path'
import os from 'os'
import fs from 'fs'

const APP_DIR_NAME = 'Pinyino'
const APP_DB_NAME = 'pinyino.db'
const LEGACY_APP_DIR_NAME = 'CodeFire'
const LEGACY_DB_NAME = 'codefire.db'

function getConfigRoot(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

export function getDatabasePath(): string {
  const configRoot = getConfigRoot()
  const preferredDir = path.join(configRoot, APP_DIR_NAME)
  const preferredPath = path.join(preferredDir, APP_DB_NAME)

  if (fs.existsSync(preferredPath)) {
    return preferredPath
  }

  const legacyPath = path.join(configRoot, LEGACY_APP_DIR_NAME, LEGACY_DB_NAME)
  if (fs.existsSync(legacyPath)) {
    return legacyPath
  }

  fs.mkdirSync(preferredDir, { recursive: true })
  return preferredPath
}
