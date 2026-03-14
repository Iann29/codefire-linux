import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'

export const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.build',
  'build',
  '.dart_tool',
  '__pycache__',
  '.next',
  'dist',
  'dist-electron',
  'release',
  'out',
  '.output',
  '.git',
  '.gradle',
  'Pods',
  '.pub-cache',
  '.pub',
  '.swiftpm',
  'DerivedData',
  '.expo',
  'coverage',
  'vendor',
  'target',
  '.cache',
  '.vite',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  '.angular',
  '.nuxt',
  '.docusaurus',
  '.storybook-static',
  'storybook-static',
  '.temp',
  'tmp',
])

export const SKIP_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'tiff', 'avif',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z',
  'dmg', 'deb', 'rpm', 'appimage', 'snap', 'flatpak',
  'asar', 'nupkg', 'msi', 'exe',
  'mp3', 'mp4', 'wav', 'mov', 'avi', 'mkv', 'flac', 'ogg', 'webm',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'lock', 'sum',
  'so', 'dylib', 'dll', 'o', 'a', 'lib', 'pyc', 'pyo', 'class', 'wasm',
  'pak', 'dat', 'bin', 'db', 'sqlite', 'sqlite3',
  'map',
  'ds_store',
])

export const MAX_FILE_SIZE = 512 * 1024

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRECTORIES.has(dirName)
}

export function shouldSkipFile(filePath: string): boolean {
  const dotIdx = filePath.lastIndexOf('.')
  if (dotIdx < 0) return false
  const ext = filePath.slice(dotIdx + 1).toLowerCase()
  return SKIP_EXTENSIONS.has(ext)
}

export function isFileTooLarge(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    return stat.size > MAX_FILE_SIZE
  } catch {
    return false
  }
}

export function shouldIndexFile(filePath: string): boolean {
  return !shouldSkipFile(filePath) && !isFileTooLarge(filePath)
}

export function enumerateFiles(dirPath: string): string[] {
  const results: string[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        results.push(...enumerateFiles(path.join(dirPath, entry.name)))
      }
      continue
    }

    if (!entry.isFile()) continue

    const fullPath = path.join(dirPath, entry.name)
    if (shouldIndexFile(fullPath)) {
      results.push(fullPath)
    }
  }

  return results
}
