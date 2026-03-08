import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, extname } from 'path'

export interface DiscoveredRoute {
  path: string
  filePath: string
  type: 'static' | 'dynamic' | 'api' | 'catch-all' | 'unknown'
  framework: string
  source: string
}

export interface RouteMapResult {
  framework: string | null
  frameworkVersion?: string
  routes: DiscoveredRoute[]
  unsupported: boolean
  generatedAt: number
}

type FrameworkId = 'nextjs-app' | 'nextjs-pages' | 'react-router' | 'astro' | 'vite-spa'

const PAGE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js']
const ASTRO_EXTENSIONS = ['.astro', '.md', '.mdx', ...PAGE_EXTENSIONS]

const NEXTJS_APP_SKIP = ['layout', 'loading', 'error', 'not-found', 'template', 'default', 'global-error']
const NEXTJS_PAGES_SKIP = ['_app', '_document', '_error']

export class RouteDiscoveryService {
  analyzeProject(projectPath: string): RouteMapResult {
    const detection = this.detectFramework(projectPath)

    if (!detection) {
      return {
        framework: null,
        routes: [],
        unsupported: true,
        generatedAt: Date.now(),
      }
    }

    const { id, version } = detection
    let routes: DiscoveredRoute[] = []

    switch (id) {
      case 'nextjs-app':
        routes = this.discoverNextjsAppRoutes(projectPath)
        break
      case 'nextjs-pages':
        routes = this.discoverNextjsPagesRoutes(projectPath)
        break
      case 'react-router':
        routes = this.discoverReactRouterRoutes(projectPath)
        break
      case 'astro':
        routes = this.discoverAstroRoutes(projectPath)
        break
      case 'vite-spa':
        routes = this.discoverViteSpaRoutes(projectPath)
        break
    }

    // Sort: static first, then alphabetical by path
    routes.sort((a, b) => {
      const typeOrder = { static: 0, api: 1, dynamic: 2, 'catch-all': 3, unknown: 4 }
      const diff = typeOrder[a.type] - typeOrder[b.type]
      if (diff !== 0) return diff
      return a.path.localeCompare(b.path)
    })

    return {
      framework: id,
      frameworkVersion: version,
      routes,
      unsupported: false,
      generatedAt: Date.now(),
    }
  }

  private detectFramework(projectPath: string): { id: FrameworkId; version?: string } | null {
    const pkgPath = join(projectPath, 'package.json')
    if (!existsSync(pkgPath)) return null

    let pkg: Record<string, unknown>
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    } catch {
      return null
    }

    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    }

    // Check Next.js
    if (deps['next']) {
      const version = deps['next'].replace(/[\^~>=<]*/g, '')
      // Determine App vs Pages Router
      const hasAppDir = existsSync(join(projectPath, 'app')) ||
        existsSync(join(projectPath, 'src', 'app'))
      const hasPagesDir = existsSync(join(projectPath, 'pages')) ||
        existsSync(join(projectPath, 'src', 'pages'))

      // Prefer App Router if both exist
      if (hasAppDir) {
        return { id: 'nextjs-app', version }
      }
      if (hasPagesDir) {
        return { id: 'nextjs-pages', version }
      }
      // Next.js detected but no pages or app dir found — default to app
      return { id: 'nextjs-app', version }
    }

    // Check Astro
    if (deps['astro']) {
      const version = deps['astro'].replace(/[\^~>=<]*/g, '')
      return { id: 'astro', version }
    }

    // Check React Router
    if (deps['react-router-dom'] || deps['react-router']) {
      const version = (deps['react-router-dom'] || deps['react-router'] || '').replace(/[\^~>=<]*/g, '')
      return { id: 'react-router', version }
    }

    // Check Vite (generic SPA fallback)
    if (deps['vite']) {
      const version = deps['vite'].replace(/[\^~>=<]*/g, '')
      return { id: 'vite-spa', version }
    }

    return null
  }

  // ── Next.js App Router ──────────────────────────────────────────────────────

  private discoverNextjsAppRoutes(projectPath: string): DiscoveredRoute[] {
    const routes: DiscoveredRoute[] = []

    // Try both app/ and src/app/
    const appDirs = [
      join(projectPath, 'app'),
      join(projectPath, 'src', 'app'),
    ]

    for (const appDir of appDirs) {
      if (!existsSync(appDir)) continue
      this.walkNextjsAppDir(projectPath, appDir, appDir, routes)
      break // Only use the first found
    }

    return routes
  }

  private walkNextjsAppDir(
    projectPath: string,
    appDir: string,
    currentDir: string,
    routes: DiscoveredRoute[]
  ) {
    let entries: string[]
    try {
      entries = readdirSync(currentDir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry)

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          // Skip node_modules, hidden dirs
          if (entry.startsWith('.') || entry === 'node_modules') continue
          this.walkNextjsAppDir(projectPath, appDir, fullPath, routes)
        } else if (stat.isFile()) {
          const nameWithoutExt = entry.replace(extname(entry), '')
          const ext = extname(entry)

          if (!PAGE_EXTENSIONS.includes(ext)) continue

          // Skip layout, loading, error, etc.
          if (NEXTJS_APP_SKIP.includes(nameWithoutExt)) continue

          const isPage = nameWithoutExt === 'page'
          const isRoute = nameWithoutExt === 'route'

          if (!isPage && !isRoute) continue

          const relDir = relative(appDir, currentDir)
          const routePath = this.appDirToRoute(relDir)
          const relFile = relative(projectPath, fullPath)

          const type = isRoute
            ? 'api' as const
            : this.classifyRoutePath(routePath)

          routes.push({
            path: routePath,
            filePath: relFile,
            type,
            framework: 'nextjs-app',
            source: 'filesystem',
          })
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }

  private appDirToRoute(relDir: string): string {
    if (!relDir || relDir === '.') return '/'

    const segments = relDir.split('/').filter(Boolean)
    const routeSegments: string[] = []

    for (const seg of segments) {
      // Route groups: (group) — strip from path
      if (seg.startsWith('(') && seg.endsWith(')')) continue

      // Parallel routes: @slot — strip from path
      if (seg.startsWith('@')) continue

      routeSegments.push(seg)
    }

    const route = '/' + routeSegments.join('/')
    return route === '/' ? '/' : route
  }

  // ── Next.js Pages Router ───────────────────────────────────────────────────

  private discoverNextjsPagesRoutes(projectPath: string): DiscoveredRoute[] {
    const routes: DiscoveredRoute[] = []

    const pagesDirs = [
      join(projectPath, 'pages'),
      join(projectPath, 'src', 'pages'),
    ]

    for (const pagesDir of pagesDirs) {
      if (!existsSync(pagesDir)) continue
      this.walkNextjsPagesDir(projectPath, pagesDir, pagesDir, routes)
      break
    }

    return routes
  }

  private walkNextjsPagesDir(
    projectPath: string,
    pagesDir: string,
    currentDir: string,
    routes: DiscoveredRoute[]
  ) {
    let entries: string[]
    try {
      entries = readdirSync(currentDir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry)

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          if (entry.startsWith('.') || entry === 'node_modules') continue
          this.walkNextjsPagesDir(projectPath, pagesDir, fullPath, routes)
        } else if (stat.isFile()) {
          const ext = extname(entry)
          if (!PAGE_EXTENSIONS.includes(ext)) continue

          const nameWithoutExt = entry.replace(ext, '')

          // Skip special files
          if (NEXTJS_PAGES_SKIP.includes(nameWithoutExt)) continue

          const relPath = relative(pagesDir, fullPath)
          const relFile = relative(projectPath, fullPath)

          // Check if it's an API route
          const isApi = relPath.startsWith('api/')

          const routePath = this.pagesFileToRoute(relPath)

          const type = isApi
            ? 'api' as const
            : this.classifyRoutePath(routePath)

          routes.push({
            path: routePath,
            filePath: relFile,
            type,
            framework: 'nextjs-pages',
            source: 'filesystem',
          })
        }
      } catch {
        // Skip
      }
    }
  }

  private pagesFileToRoute(relPath: string): string {
    // Remove extension
    let route = relPath.replace(extname(relPath), '')

    // index files map to the parent directory
    if (route.endsWith('/index')) {
      route = route.slice(0, -6)
    } else if (route === 'index') {
      route = ''
    }

    return '/' + route
  }

  // ── React Router ────────────────────────────────────────────────────────────

  private discoverReactRouterRoutes(projectPath: string): DiscoveredRoute[] {
    const routes: DiscoveredRoute[] = []
    const srcDir = join(projectPath, 'src')
    const searchDirs = existsSync(srcDir) ? [srcDir] : [projectPath]

    // Patterns to match route definitions
    const pathPatterns = [
      // <Route path="/about" ...>
      /path\s*=\s*["']([^"']+)["']/g,
      // { path: "/about", ... }
      /path\s*:\s*["']([^"']+)["']/g,
    ]

    for (const dir of searchDirs) {
      this.scanFilesForRoutes(projectPath, dir, pathPatterns, routes)
    }

    // Deduplicate by path
    const seen = new Set<string>()
    return routes.filter((r) => {
      if (seen.has(r.path)) return false
      seen.add(r.path)
      return true
    })
  }

  private scanFilesForRoutes(
    projectPath: string,
    dir: string,
    patterns: RegExp[],
    routes: DiscoveredRoute[]
  ) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'build') continue

      const fullPath = join(dir, entry)

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          this.scanFilesForRoutes(projectPath, fullPath, patterns, routes)
        } else if (stat.isFile()) {
          const ext = extname(entry)
          if (!PAGE_EXTENSIONS.includes(ext)) continue

          const content = readFileSync(fullPath, 'utf-8')

          // Only scan files that import from react-router
          if (!content.includes('react-router') && !content.includes('createBrowserRouter') && !content.includes('<Route')) continue

          const relFile = relative(projectPath, fullPath)

          for (const pattern of patterns) {
            // Reset regex state
            pattern.lastIndex = 0
            let match: RegExpExecArray | null
            while ((match = pattern.exec(content)) !== null) {
              const routePath = match[1]

              // Skip wildcard-only or empty
              if (!routePath || routePath === '*') continue

              routes.push({
                path: routePath.startsWith('/') ? routePath : '/' + routePath,
                filePath: relFile,
                type: this.classifyRoutePath(routePath),
                framework: 'react-router',
                source: 'code-analysis',
              })
            }
          }
        }
      } catch {
        // Skip
      }
    }
  }

  // ── Astro ───────────────────────────────────────────────────────────────────

  private discoverAstroRoutes(projectPath: string): DiscoveredRoute[] {
    const routes: DiscoveredRoute[] = []

    const pagesDir = join(projectPath, 'src', 'pages')
    if (!existsSync(pagesDir)) return routes

    this.walkAstroPagesDir(projectPath, pagesDir, pagesDir, routes)
    return routes
  }

  private walkAstroPagesDir(
    projectPath: string,
    pagesDir: string,
    currentDir: string,
    routes: DiscoveredRoute[]
  ) {
    let entries: string[]
    try {
      entries = readdirSync(currentDir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry)

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          if (entry.startsWith('.') || entry === 'node_modules') continue
          this.walkAstroPagesDir(projectPath, pagesDir, fullPath, routes)
        } else if (stat.isFile()) {
          const ext = extname(entry)
          if (!ASTRO_EXTENSIONS.includes(ext)) continue

          const relPath = relative(pagesDir, fullPath)
          const relFile = relative(projectPath, fullPath)
          const routePath = this.pagesFileToRoute(relPath)

          routes.push({
            path: routePath,
            filePath: relFile,
            type: this.classifyRoutePath(routePath),
            framework: 'astro',
            source: 'filesystem',
          })
        }
      } catch {
        // Skip
      }
    }
  }

  // ── Vite SPA ────────────────────────────────────────────────────────────────

  private discoverViteSpaRoutes(_projectPath: string): DiscoveredRoute[] {
    return [
      {
        path: '/',
        filePath: 'index.html',
        type: 'static',
        framework: 'vite-spa',
        source: 'inferred',
      },
    ]
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private classifyRoutePath(routePath: string): DiscoveredRoute['type'] {
    if (routePath.includes('[...') || routePath.includes('*')) return 'catch-all'
    if (routePath.includes('[') || routePath.includes(':')) return 'dynamic'
    return 'static'
  }
}
