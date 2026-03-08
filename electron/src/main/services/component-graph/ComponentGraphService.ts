import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, dirname, resolve } from 'path'

export interface ComponentNode {
  id: string
  name: string
  filePath: string
  exportName: string
  isDefaultExport: boolean
  framework: 'react' | 'vue' | 'svelte' | 'unknown'
  importCount: number
  renderCount: number
}

export interface ComponentEdge {
  fromFile: string
  toFile: string
  fromName: string
  toName: string
  relation: 'imports' | 'renders' | 're-exports'
}

export interface ComponentGraphResult {
  generatedAt: number
  totalComponents: number
  totalEdges: number
  nodes: ComponentNode[]
  edges: ComponentEdge[]
  entryPoints: string[]
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '.svelte-kit', '.output', 'coverage', '__pycache__', '.cache',
])

export class ComponentGraphService {
  analyzeProject(projectPath: string): ComponentGraphResult {
    const files = new Map<string, string>() // relPath -> content
    const components = new Map<string, ComponentNode>()
    const edges: ComponentEdge[] = []

    // Collect all relevant files
    this.walkFiles(projectPath, ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte'], (filePath, content) => {
      const relPath = relative(projectPath, filePath)
      files.set(relPath, content)
    })

    // Pass 1: Detect component declarations
    for (const [relPath, content] of files) {
      const ext = extname(relPath)
      const framework = this.detectFramework(ext, content)

      // React/TSX components
      if (framework === 'react') {
        this.extractReactComponents(relPath, content, components)
      }
    }

    // Pass 2: Build edges from imports
    for (const [relPath, content] of files) {
      this.extractImportEdges(relPath, content, projectPath, components, edges)
    }

    // Pass 3: Detect JSX renders
    for (const [relPath, content] of files) {
      this.extractRenderEdges(relPath, content, components, edges)
    }

    // Calculate import counts
    for (const edge of edges) {
      if (edge.relation === 'imports' || edge.relation === 're-exports') {
        const node = components.get(edge.toName)
        if (node) node.importCount++
      }
      if (edge.relation === 'renders') {
        const node = components.get(edge.toName)
        if (node) node.renderCount++
      }
    }

    // Detect entry points (files that are imported by no one)
    const importedFiles = new Set(edges.filter(e => e.relation === 'imports').map(e => e.toFile))
    const entryPoints = Array.from(files.keys()).filter(f =>
      !importedFiles.has(f) && components.has(Array.from(components.values()).find(c => c.filePath === f)?.name ?? '')
    )

    const nodes = Array.from(components.values())

    return {
      generatedAt: Date.now(),
      totalComponents: nodes.length,
      totalEdges: edges.length,
      nodes: nodes.sort((a, b) => b.importCount - a.importCount),
      edges,
      entryPoints,
    }
  }

  private detectFramework(ext: string, content: string): ComponentNode['framework'] {
    if (ext === '.vue') return 'vue'
    if (ext === '.svelte') return 'svelte'
    if (ext === '.tsx' || ext === '.jsx') return 'react'
    if (content.includes('from \'react\'') || content.includes('from "react"')) return 'react'
    if (content.includes('from \'vue\'') || content.includes('from "vue"')) return 'vue'
    return 'unknown'
  }

  private extractReactComponents(
    filePath: string,
    content: string,
    components: Map<string, ComponentNode>
  ) {
    // Match: export default function ComponentName
    const defaultFuncMatch = content.match(/export\s+default\s+function\s+([A-Z]\w+)/)
    if (defaultFuncMatch) {
      const name = defaultFuncMatch[1]
      components.set(name, {
        id: `${filePath}:${name}`,
        name,
        filePath,
        exportName: name,
        isDefaultExport: true,
        framework: 'react',
        importCount: 0,
        renderCount: 0,
      })
    }

    // Match: export function ComponentName
    const namedFuncRegex = /export\s+function\s+([A-Z]\w+)/g
    let match
    while ((match = namedFuncRegex.exec(content)) !== null) {
      const name = match[1]
      if (!components.has(name)) {
        components.set(name, {
          id: `${filePath}:${name}`,
          name,
          filePath,
          exportName: name,
          isDefaultExport: false,
          framework: 'react',
          importCount: 0,
          renderCount: 0,
        })
      }
    }

    // Match: const ComponentName = ... (with export)
    const constRegex = /export\s+const\s+([A-Z]\w+)\s*[=:]/g
    while ((match = constRegex.exec(content)) !== null) {
      const name = match[1]
      if (!components.has(name)) {
        components.set(name, {
          id: `${filePath}:${name}`,
          name,
          filePath,
          exportName: name,
          isDefaultExport: false,
          framework: 'react',
          importCount: 0,
          renderCount: 0,
        })
      }
    }

    // Match: function ComponentName followed by export default ComponentName
    const funcRegex = /function\s+([A-Z]\w+)\s*\(/g
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1]
      if (!components.has(name) && content.includes(`export default ${name}`)) {
        components.set(name, {
          id: `${filePath}:${name}`,
          name,
          filePath,
          exportName: name,
          isDefaultExport: true,
          framework: 'react',
          importCount: 0,
          renderCount: 0,
        })
      }
    }
  }

  private extractImportEdges(
    filePath: string,
    content: string,
    projectPath: string,
    components: Map<string, ComponentNode>,
    edges: ComponentEdge[]
  ) {
    // Match import statements
    const importRegex = /import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?\s+from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = importRegex.exec(content)) !== null) {
      const defaultImport = match[1]
      const namedImports = match[2]
      const source = match[3]

      // Only process relative imports
      if (!source.startsWith('.') && !source.startsWith('@')) continue

      // Try to resolve the import path
      let resolvedPath: string | null = null
      if (source.startsWith('.')) {
        const dir = dirname(join(projectPath, filePath))
        const candidate = resolve(dir, source)
        const relCandidate = relative(projectPath, candidate)
        // Try various extensions
        for (const ext of ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']) {
          const tryPath = relCandidate + ext
          if (components.has(defaultImport || '') ||
              Array.from(components.values()).some(c => c.filePath === tryPath)) {
            resolvedPath = tryPath
            break
          }
        }
      }

      if (defaultImport && /^[A-Z]/.test(defaultImport)) {
        edges.push({
          fromFile: filePath,
          toFile: resolvedPath || source,
          fromName: filePath,
          toName: defaultImport,
          relation: 'imports',
        })
      }

      if (namedImports) {
        const names = namedImports.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim())
        for (const name of names) {
          if (/^[A-Z]/.test(name)) {
            edges.push({
              fromFile: filePath,
              toFile: resolvedPath || source,
              fromName: filePath,
              toName: name,
              relation: 'imports',
            })
          }
        }
      }
    }
  }

  private extractRenderEdges(
    filePath: string,
    content: string,
    components: Map<string, ComponentNode>,
    edges: ComponentEdge[]
  ) {
    // Find JSX component usage: <ComponentName or <ComponentName.
    const jsxRegex = /<([A-Z]\w+)[\s/>]/g
    let match
    const seen = new Set<string>()
    while ((match = jsxRegex.exec(content)) !== null) {
      const name = match[1]
      if (seen.has(name)) continue
      seen.add(name)
      if (components.has(name)) {
        edges.push({
          fromFile: filePath,
          toFile: components.get(name)!.filePath,
          fromName: filePath,
          toName: name,
          relation: 'renders',
        })
      }
    }
  }

  private walkFiles(
    dir: string,
    extensions: string[],
    callback: (filePath: string, content: string) => void,
    depth = 0
  ) {
    if (depth > 8) return
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
            if (stat.size > 200_000) continue
            const content = readFileSync(fullPath, 'utf-8')
            callback(fullPath, content)
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }
}
