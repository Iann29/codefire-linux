import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname } from 'path'

export interface DesignToken {
  kind: 'color' | 'spacing' | 'radius' | 'shadow' | 'typography' | 'z-index' | 'other'
  name: string
  value: string
  normalizedValue: string
  namespace: string
  sourceFile: string
  sourceLine: number
  sourceType: 'css-var' | 'tailwind-config' | 'theme-object' | 'sass-var' | 'other'
}

export interface DesignSystemSnapshot {
  generatedAt: number
  framework: string | null
  tokenCount: number
  tokens: DesignToken[]
  styleStack: string[]
  inconsistencies: DesignInconsistency[]
}

export interface DesignInconsistency {
  kind: 'near-duplicate' | 'unused-token' | 'inline-override'
  title: string
  tokens: string[]
  evidence: string
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '.svelte-kit', '.output', 'coverage', '__pycache__', '.cache',
])

export class DesignSystemService {
  analyzeProject(projectPath: string): DesignSystemSnapshot {
    const tokens: DesignToken[] = []
    const styleStack = new Set<string>()

    // Detect style stack
    if (existsSync(join(projectPath, 'tailwind.config.ts')) ||
        existsSync(join(projectPath, 'tailwind.config.js')) ||
        existsSync(join(projectPath, 'tailwind.config.mjs'))) {
      styleStack.add('Tailwind CSS')
      this.extractTailwindTokens(projectPath, tokens)
    }

    // Scan CSS files for CSS variables
    this.walkFiles(projectPath, ['.css'], (filePath, content) => {
      const relPath = relative(projectPath, filePath)
      if (relPath.includes('.module.')) styleStack.add('CSS Modules')
      this.extractCssVariables(content, relPath, tokens)
    })

    // Scan JS/TS files for theme objects and styled-components
    this.walkFiles(projectPath, ['.ts', '.tsx', '.js', '.jsx'], (filePath, content) => {
      const relPath = relative(projectPath, filePath)
      if (content.includes('styled-components') || content.includes('styled(')) {
        styleStack.add('styled-components')
      }
      if (content.includes('@emotion')) {
        styleStack.add('Emotion')
      }
      this.extractThemeObjects(content, relPath, tokens)
    })

    // Check for plain CSS
    if (tokens.some(t => t.sourceType === 'css-var')) {
      styleStack.add('CSS Variables')
    }

    // Find inconsistencies
    const inconsistencies = this.findInconsistencies(tokens)

    return {
      generatedAt: Date.now(),
      framework: this.detectFramework(projectPath),
      tokenCount: tokens.length,
      tokens,
      styleStack: Array.from(styleStack),
      inconsistencies,
    }
  }

  private detectFramework(projectPath: string): string | null {
    try {
      const pkgPath = join(projectPath, 'package.json')
      if (!existsSync(pkgPath)) return null
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['next']) return 'Next.js'
      if (deps['@sveltejs/kit'] || deps['svelte']) return 'Svelte'
      if (deps['nuxt'] || deps['vue']) return 'Vue'
      if (deps['astro']) return 'Astro'
      if (deps['react']) return 'React'
      return null
    } catch {
      return null
    }
  }

  private extractTailwindTokens(projectPath: string, tokens: DesignToken[]) {
    const configFiles = [
      'tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs',
    ]
    for (const file of configFiles) {
      const filePath = join(projectPath, file)
      if (!existsSync(filePath)) continue
      try {
        const content = readFileSync(filePath, 'utf-8')
        // Extract color definitions
        const colorMatch = content.match(/colors?\s*:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s)
        if (colorMatch) {
          this.parseObjectLiteral(colorMatch[1], 'color', file, 'tailwind-config', tokens)
        }
        // Extract spacing
        const spacingMatch = content.match(/spacing\s*:\s*\{([^}]+)\}/s)
        if (spacingMatch) {
          this.parseObjectLiteral(spacingMatch[1], 'spacing', file, 'tailwind-config', tokens)
        }
        // Extract border radius
        const radiusMatch = content.match(/borderRadius\s*:\s*\{([^}]+)\}/s)
        if (radiusMatch) {
          this.parseObjectLiteral(radiusMatch[1], 'radius', file, 'tailwind-config', tokens)
        }
        // Extract font families
        const fontMatch = content.match(/fontFamily\s*:\s*\{([^}]+)\}/s)
        if (fontMatch) {
          this.parseObjectLiteral(fontMatch[1], 'typography', file, 'tailwind-config', tokens)
        }
      } catch {
        // Skip unparseable configs
      }
      break // Only process first found config
    }
  }

  private parseObjectLiteral(
    content: string,
    kind: DesignToken['kind'],
    sourceFile: string,
    sourceType: DesignToken['sourceType'],
    tokens: DesignToken[]
  ) {
    const regex = /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g
    let match
    while ((match = regex.exec(content)) !== null) {
      tokens.push({
        kind,
        name: match[1],
        value: match[2],
        normalizedValue: match[2].toLowerCase().trim(),
        namespace: 'tailwind',
        sourceFile,
        sourceLine: content.substring(0, match.index).split('\n').length,
        sourceType,
      })
    }
  }

  private extractCssVariables(content: string, filePath: string, tokens: DesignToken[]) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = line.match(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/)
      if (!match) continue

      const name = match[1]
      const value = match[2].trim()
      const kind = this.classifyTokenKind(name, value)

      tokens.push({
        kind,
        name: `--${name}`,
        value,
        normalizedValue: value.toLowerCase().trim(),
        namespace: 'css',
        sourceFile: filePath,
        sourceLine: i + 1,
        sourceType: 'css-var',
      })
    }
  }

  private extractThemeObjects(content: string, filePath: string, tokens: DesignToken[]) {
    // Look for theme/colors/palette objects
    const themePatterns = [
      /(?:theme|colors|palette|tokens)\s*(?:=|:)\s*\{/g,
    ]
    for (const pattern of themePatterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const start = match.index + match[0].length
        const block = this.extractBlock(content, start)
        if (!block) continue

        const lineOffset = content.substring(0, match.index).split('\n').length
        const regex = /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g
        let inner
        while ((inner = regex.exec(block)) !== null) {
          const name = inner[1]
          const value = inner[2]
          const kind = this.classifyTokenKind(name, value)
          tokens.push({
            kind,
            name,
            value,
            normalizedValue: value.toLowerCase().trim(),
            namespace: 'theme',
            sourceFile: filePath,
            sourceLine: lineOffset + block.substring(0, inner.index).split('\n').length,
            sourceType: 'theme-object',
          })
        }
      }
    }
  }

  private extractBlock(content: string, start: number): string | null {
    let depth = 1
    let i = start
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++
      if (content[i] === '}') depth--
      i++
    }
    if (depth !== 0) return null
    return content.substring(start, i - 1)
  }

  private classifyTokenKind(name: string, value: string): DesignToken['kind'] {
    const nl = name.toLowerCase()
    const vl = value.toLowerCase()

    if (nl.includes('color') || nl.includes('bg') || nl.includes('foreground') ||
        nl.includes('primary') || nl.includes('secondary') || nl.includes('accent') ||
        nl.includes('border') || nl.includes('surface') || nl.includes('muted') ||
        /^#[0-9a-f]{3,8}$/i.test(vl) || vl.startsWith('rgb') || vl.startsWith('hsl') ||
        vl.startsWith('oklch') || vl.startsWith('var(--')) {
      return 'color'
    }
    if (nl.includes('space') || nl.includes('gap') || nl.includes('padding') ||
        nl.includes('margin') || /^\d+(\.\d+)?(rem|px|em)$/.test(vl)) {
      return 'spacing'
    }
    if (nl.includes('radius') || nl.includes('rounded')) return 'radius'
    if (nl.includes('shadow') || nl.includes('elevation')) return 'shadow'
    if (nl.includes('font') || nl.includes('text') || nl.includes('heading') ||
        nl.includes('line-height') || nl.includes('letter')) return 'typography'
    if (nl.includes('z-index') || nl.includes('zindex')) return 'z-index'
    return 'other'
  }

  private findInconsistencies(tokens: DesignToken[]): DesignInconsistency[] {
    const inconsistencies: DesignInconsistency[] = []

    // Find near-duplicate colors
    const colorTokens = tokens.filter(t => t.kind === 'color')
    for (let i = 0; i < colorTokens.length; i++) {
      for (let j = i + 1; j < colorTokens.length; j++) {
        const a = colorTokens[i]
        const b = colorTokens[j]
        if (a.normalizedValue === b.normalizedValue && a.name !== b.name) {
          inconsistencies.push({
            kind: 'near-duplicate',
            title: `Duplicate color value: ${a.value}`,
            tokens: [a.name, b.name],
            evidence: `${a.name} (${a.sourceFile}) and ${b.name} (${b.sourceFile}) both resolve to ${a.value}`,
          })
        }
      }
    }

    return inconsistencies.slice(0, 50) // Cap at 50
  }

  private walkFiles(
    dir: string,
    extensions: string[],
    callback: (filePath: string, content: string) => void,
    depth = 0
  ) {
    if (depth > 6) return
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue
        const fullPath = join(dir, entry)
        try {
          const stat = statSync(fullPath)
          if (stat.isDirectory()) {
            this.walkFiles(fullPath, extensions, callback, depth + 1)
          } else if (extensions.includes(extname(entry).toLowerCase())) {
            if (stat.size > 100_000) continue // Skip very large files
            const content = readFileSync(fullPath, 'utf-8')
            callback(fullPath, content)
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }
}
