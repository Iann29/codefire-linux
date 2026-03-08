import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, basename } from 'path'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface EnvDefinition {
  key: string
  filePath: string
  fileName: string
  hasValue: boolean
  comment?: string
}

export interface EnvUsage {
  key: string
  filePath: string
  line: number
  syntax: string
}

export interface EnvDoctorIssue {
  severity: 'error' | 'warning' | 'info'
  code: 'missing' | 'unused' | 'undocumented' | 'suspicious_exposure'
  key: string
  title: string
  evidence: string[]
  remediation: string
}

export interface EnvDoctorReport {
  generatedAt: number
  totalDefinitions: number
  totalUsages: number
  issues: EnvDoctorIssue[]
  score: number
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'vendor',
])

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
])

const SCAN_DIRS = [
  'src',
  'app',
  'pages',
  'lib',
  'components',
  'server',
  'api',
  'utils',
  'helpers',
  'config',
  'middleware',
  'services',
  'hooks',
  'stores',
  'plugins',
]

const EXAMPLE_FILE_NAMES = ['.env.example', '.env.template', '.env.sample']

/** Prefixes that expose vars to client-side bundles */
const CLIENT_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'NUXT_PUBLIC_', 'EXPO_PUBLIC_']

/** Keys that look like secrets based on naming patterns */
const SECRET_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /PRIVATE_KEY/i,
  /TOKEN/i,
  /API_KEY/i,
  /AUTH/i,
  /CREDENTIAL/i,
  /SIGNING/i,
  /ENCRYPTION/i,
]

// ─── Regex patterns for env usage detection ─────────────────────────────────────

const USAGE_PATTERNS = [
  // process.env.VAR_NAME
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  // process.env['VAR_NAME'] or process.env["VAR_NAME"]
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  // import.meta.env.VAR_NAME
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  // Deno.env.get('VAR_NAME')
  /Deno\.env\.get\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g,
]

const DESTRUCTURE_PATTERN = /const\s*\{([^}]+)\}\s*=\s*process\.env/g

// ─── Service ────────────────────────────────────────────────────────────────────

export class EnvDoctorService {
  analyzeProject(projectPath: string): EnvDoctorReport {
    const definitions = this.scanEnvFiles(projectPath)
    const usages = this.scanCodeUsages(projectPath)
    const examples = this.findExampleFiles(projectPath)

    return this.generateReport(definitions, usages, examples)
  }

  // ── Scan .env files for definitions ─────────────────────────────────────────

  private scanEnvFiles(projectPath: string): EnvDefinition[] {
    const definitions: EnvDefinition[] = []

    try {
      const entries = readdirSync(projectPath)
      const envFiles = entries.filter(
        (e) => e === '.env' || e.startsWith('.env.')
      )

      for (const fileName of envFiles) {
        // Skip example/template files here — they are handled separately
        if (EXAMPLE_FILE_NAMES.includes(fileName)) continue

        const filePath = join(projectPath, fileName)
        try {
          const stat = statSync(filePath)
          if (!stat.isFile()) continue

          const content = readFileSync(filePath, 'utf-8')
          const parsed = this.parseEnvContent(content)

          for (const entry of parsed) {
            definitions.push({
              key: entry.key,
              filePath,
              fileName,
              hasValue: entry.hasValue,
              comment: entry.comment,
            })
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory unreadable
    }

    return definitions
  }

  // ── Parse .env file content ─────────────────────────────────────────────────

  private parseEnvContent(
    content: string
  ): Array<{ key: string; hasValue: boolean; comment?: string }> {
    const lines = content.split('\n')
    const result: Array<{ key: string; hasValue: boolean; comment?: string }> = []
    let pendingComment: string | undefined

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('#')) {
        const commentText = trimmed.slice(1).trim()
        pendingComment = pendingComment
          ? `${pendingComment}\n${commentText}`
          : commentText
        continue
      }

      if (trimmed.length === 0) {
        pendingComment = undefined
        continue
      }

      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) {
        pendingComment = undefined
        continue
      }

      const key = trimmed.slice(0, eqIndex).trim()
      const rawValue = trimmed.slice(eqIndex + 1).trim()

      // Only track if key looks valid
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        pendingComment = undefined
        continue
      }

      const entry: { key: string; hasValue: boolean; comment?: string } = {
        key,
        hasValue: rawValue.length > 0,
      }
      if (pendingComment) {
        entry.comment = pendingComment
      }
      result.push(entry)
      pendingComment = undefined
    }

    return result
  }

  // ── Scan source code for env variable usages ────────────────────────────────

  private scanCodeUsages(projectPath: string): EnvUsage[] {
    const usages: EnvUsage[] = []
    const seenKeys = new Set<string>()

    // Determine which directories to scan
    const dirsToScan: string[] = []

    for (const dir of SCAN_DIRS) {
      const fullPath = join(projectPath, dir)
      try {
        if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
          dirsToScan.push(fullPath)
        }
      } catch {
        // Skip
      }
    }

    // Also scan loose config files in root (next.config.ts, vite.config.ts, etc.)
    try {
      const rootEntries = readdirSync(projectPath)
      for (const entry of rootEntries) {
        if (entry.startsWith('.')) continue
        const ext = this.getExtension(entry)
        if (SOURCE_EXTENSIONS.has(ext)) {
          const filePath = join(projectPath, entry)
          try {
            if (statSync(filePath).isFile()) {
              this.scanFile(filePath, projectPath, usages, seenKeys)
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Skip
    }

    // Walk each scan directory
    for (const dir of dirsToScan) {
      this.walkDirectory(dir, projectPath, usages, seenKeys)
    }

    return usages
  }

  private walkDirectory(
    dirPath: string,
    projectPath: string,
    usages: EnvUsage[],
    seenKeys: Set<string>,
    depth = 0
  ): void {
    // Safety: limit depth to avoid deep recursion
    if (depth > 15) return

    try {
      const entries = readdirSync(dirPath)

      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        if (SKIP_DIRS.has(entry)) continue

        const fullPath = join(dirPath, entry)

        try {
          const stat = statSync(fullPath)

          if (stat.isDirectory()) {
            this.walkDirectory(fullPath, projectPath, usages, seenKeys, depth + 1)
          } else if (stat.isFile()) {
            const ext = this.getExtension(entry)
            if (SOURCE_EXTENSIONS.has(ext)) {
              this.scanFile(fullPath, projectPath, usages, seenKeys)
            }
          }
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  private scanFile(
    filePath: string,
    projectPath: string,
    usages: EnvUsage[],
    _seenKeys: Set<string>
  ): void {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const relPath = relative(projectPath, filePath)

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Check each usage pattern
        for (const pattern of USAGE_PATTERNS) {
          // Reset regex lastIndex since we use /g flag
          pattern.lastIndex = 0
          let match: RegExpExecArray | null

          while ((match = pattern.exec(line)) !== null) {
            const key = match[1]
            // Skip NODE_ENV and similar built-in vars
            if (this.isBuiltinVar(key)) continue

            usages.push({
              key,
              filePath: relPath,
              line: i + 1,
              syntax: this.detectSyntaxType(match[0]),
            })
          }
        }

        // Check destructured pattern: const { VAR1, VAR2 } = process.env
        DESTRUCTURE_PATTERN.lastIndex = 0
        let destructMatch: RegExpExecArray | null

        while ((destructMatch = DESTRUCTURE_PATTERN.exec(line)) !== null) {
          const vars = destructMatch[1].split(',').map((v) => v.trim())
          for (const varName of vars) {
            // Handle renaming: VAR_NAME: localName
            const actualKey = varName.split(':')[0].trim()
            if (!actualKey || this.isBuiltinVar(actualKey)) continue
            if (!/^[A-Z_][A-Z0-9_]*$/.test(actualKey)) continue

            usages.push({
              key: actualKey,
              filePath: relPath,
              line: i + 1,
              syntax: 'destructured',
            })
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // ── Find example/template .env files ────────────────────────────────────────

  private findExampleFiles(
    projectPath: string
  ): Array<{ fileName: string; keys: Set<string> }> {
    const result: Array<{ fileName: string; keys: Set<string> }> = []

    for (const name of EXAMPLE_FILE_NAMES) {
      const filePath = join(projectPath, name)
      try {
        if (!existsSync(filePath)) continue

        const content = readFileSync(filePath, 'utf-8')
        const parsed = this.parseEnvContent(content)
        const keys = new Set(parsed.map((p) => p.key))

        result.push({ fileName: name, keys })
      } catch {
        // Skip
      }
    }

    return result
  }

  // ── Generate the final report ───────────────────────────────────────────────

  private generateReport(
    definitions: EnvDefinition[],
    usages: EnvUsage[],
    examples: Array<{ fileName: string; keys: Set<string> }>
  ): EnvDoctorReport {
    const issues: EnvDoctorIssue[] = []

    // Build lookup sets
    const definedKeys = new Set(definitions.map((d) => d.key))
    const usedKeys = new Set(usages.map((u) => u.key))
    const exampleKeys = new Set<string>()
    for (const ex of examples) {
      for (const k of ex.keys) {
        exampleKeys.add(k)
      }
    }

    // Group usages by key for evidence
    const usagesByKey = new Map<string, EnvUsage[]>()
    for (const u of usages) {
      if (!usagesByKey.has(u.key)) {
        usagesByKey.set(u.key, [])
      }
      usagesByKey.get(u.key)!.push(u)
    }

    // Group definitions by key for evidence
    const defsByKey = new Map<string, EnvDefinition[]>()
    for (const d of definitions) {
      if (!defsByKey.has(d.key)) {
        defsByKey.set(d.key, [])
      }
      defsByKey.get(d.key)!.push(d)
    }

    // ── 1. MISSING: used in code but not defined in any .env file ───────────
    for (const key of usedKeys) {
      if (!definedKeys.has(key) && !exampleKeys.has(key)) {
        const refs = usagesByKey.get(key) || []
        const uniqueFiles = [...new Set(refs.map((r) => r.filePath))]

        issues.push({
          severity: 'error',
          code: 'missing',
          key,
          title: `"${key}" is used in code but not defined in any .env file`,
          evidence: uniqueFiles.map(
            (f) => {
              const lineRefs = refs.filter((r) => r.filePath === f)
              return `${f} (line${lineRefs.length > 1 ? 's' : ''} ${lineRefs.map((r) => r.line).join(', ')})`
            }
          ),
          remediation: `Add ${key}= to your .env file`,
        })
      }
    }

    // ── 2. UNUSED: defined in .env but never referenced in code ─────────────
    for (const key of definedKeys) {
      if (!usedKeys.has(key)) {
        const defs = defsByKey.get(key) || []
        const fileNames = [...new Set(defs.map((d) => d.fileName))]

        issues.push({
          severity: 'warning',
          code: 'unused',
          key,
          title: `"${key}" is defined but never referenced in source code`,
          evidence: fileNames.map((f) => `Defined in ${f}`),
          remediation: `Remove ${key} from your .env file if no longer needed`,
        })
      }
    }

    // ── 3. UNDOCUMENTED: in .env but not in .env.example ────────────────────
    if (examples.length > 0) {
      for (const key of definedKeys) {
        if (!exampleKeys.has(key)) {
          const defs = defsByKey.get(key) || []
          const fileNames = [...new Set(defs.map((d) => d.fileName))]

          issues.push({
            severity: 'info',
            code: 'undocumented',
            key,
            title: `"${key}" is not documented in ${examples.map((e) => e.fileName).join(', ')}`,
            evidence: fileNames.map((f) => `Present in ${f}`),
            remediation: `Add ${key}= to your .env.example for documentation`,
          })
        }
      }
    }

    // ── 4. SUSPICIOUS CLIENT EXPOSURE ───────────────────────────────────────
    for (const key of definedKeys) {
      const isClientExposed = CLIENT_PREFIXES.some((prefix) =>
        key.startsWith(prefix)
      )
      if (!isClientExposed) continue

      const looksLikeSecret = SECRET_PATTERNS.some((pattern) =>
        pattern.test(key)
      )
      if (!looksLikeSecret) continue

      const defs = defsByKey.get(key) || []
      const fileNames = [...new Set(defs.map((d) => d.fileName))]

      issues.push({
        severity: 'warning',
        code: 'suspicious_exposure',
        key,
        title: `"${key}" has a public prefix but looks like a secret`,
        evidence: fileNames.map((f) => `Defined in ${f}`),
        remediation: `Verify that ${key} should be exposed to the client. If it is a secret, remove the public prefix.`,
      })
    }

    // ── Calculate health score ──────────────────────────────────────────────
    const score = this.calculateScore(issues, definitions.length, usages.length)

    // Sort issues: errors first, then warnings, then info
    const severityOrder = { error: 0, warning: 1, info: 2 }
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    return {
      generatedAt: Date.now(),
      totalDefinitions: definitions.length,
      totalUsages: usages.length,
      issues,
      score,
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private calculateScore(
    issues: EnvDoctorIssue[],
    totalDefs: number,
    totalUsages: number
  ): number {
    if (totalDefs === 0 && totalUsages === 0) return 100

    let penalty = 0
    for (const issue of issues) {
      switch (issue.severity) {
        case 'error':
          penalty += 15
          break
        case 'warning':
          penalty += 8
          break
        case 'info':
          penalty += 3
          break
      }
    }

    return Math.max(0, Math.min(100, 100 - penalty))
  }

  private getExtension(fileName: string): string {
    const dot = fileName.lastIndexOf('.')
    return dot === -1 ? '' : fileName.slice(dot)
  }

  private isBuiltinVar(key: string): boolean {
    const builtins = new Set([
      'NODE_ENV',
      'NODE_DEBUG',
      'NODE_OPTIONS',
      'HOME',
      'PATH',
      'USER',
      'SHELL',
      'LANG',
      'TERM',
      'PWD',
      'HOSTNAME',
      'CI',
      'PORT',
      'HOST',
      'TZ',
    ])
    return builtins.has(key)
  }

  private detectSyntaxType(match: string): string {
    if (match.includes('import.meta.env')) return 'import.meta.env'
    if (match.includes('Deno.env')) return 'Deno.env'
    if (match.includes('process.env[')) return 'process.env[]'
    return 'process.env'
  }
}
