import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { RouteDiscoveryService, type DiscoveredRoute } from '../routes/RouteDiscoveryService'
import { ComponentGraphService, type ComponentEdge, type ComponentNode } from '../component-graph/ComponentGraphService'
import type { ResolvePageContextInput, PageContextEvidence } from '@shared/models'

// ─── Route matching helpers ──────────────────────────────────────────────────

/**
 * Convert a framework route pattern to a regex for matching pathnames.
 * Handles Next.js bracket syntax and react-router colon syntax.
 */
function routePatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    // Optional catch-all: [[...param]] → match zero or more segments
    .replace(/\[\[\.\.\.(\w+)\]\]/g, '(?:/.*)?')
    // Catch-all: [...param] → match one or more segments (consumes the preceding /)
    .replace(/\/\[\.\.\.(\w+)\]/g, '(?:/.+)')
    // Dynamic segment: [param] → match one segment
    .replace(/\[(\w+)\]/g, '([^/]+)')
    // React-router style: :param → match one segment
    .replace(/:(\w+)/g, '([^/]+)')

  return new RegExp(`^${escaped}$`)
}

interface RankedRoute {
  route: DiscoveredRoute
  score: number
}

function rankRoutes(pathname: string, routes: DiscoveredRoute[]): RankedRoute[] {
  const ranked: RankedRoute[] = []

  for (const route of routes) {
    const regex = routePatternToRegex(route.path)
    if (!regex.test(pathname)) continue

    // Score: prefer exact static > dynamic > catch-all
    let score = 0
    if (route.type === 'static') score = 100
    else if (route.type === 'dynamic') score = 50
    else if (route.type === 'catch-all') score = 10
    else score = 1

    // Bonus for longer paths (more specific match)
    score += route.path.split('/').filter(Boolean).length

    ranked.push({ route, score })
  }

  return ranked.sort((a, b) => b.score - a.score)
}

// ─── Component resolution ────────────────────────────────────────────────────

interface ResolvedComponent {
  name: string
  filePath: string
  relation: 'route-export' | 'direct-import' | 'direct-render' | 'one-hop-render'
  confidence: 'confirmed' | 'inferred'
}

function resolveComponents(
  routeFilePath: string | null,
  nodes: ComponentNode[],
  edges: ComponentEdge[]
): ResolvedComponent[] {
  if (!routeFilePath) return []

  const result: ResolvedComponent[] = []
  const seen = new Set<string>()

  // 1. Component exported by the route file itself
  const routeComponents = nodes.filter(n => n.filePath === routeFilePath)
  for (const comp of routeComponents) {
    const key = `${comp.filePath}:${comp.name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name: comp.name,
      filePath: comp.filePath,
      relation: 'route-export',
      confidence: 'confirmed',
    })
  }

  // 2. Direct imports from the route file
  const directImports = edges.filter(
    e => e.fromFile === routeFilePath && e.relation === 'imports'
  )
  for (const edge of directImports) {
    const node = nodes.find(n => n.name === edge.toName)
    if (!node) continue
    const key = `${node.filePath}:${node.name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name: node.name,
      filePath: node.filePath,
      relation: 'direct-import',
      confidence: 'confirmed',
    })
  }

  // 3. Direct renders from the route file
  const directRenders = edges.filter(
    e => e.fromFile === routeFilePath && e.relation === 'renders'
  )
  for (const edge of directRenders) {
    const node = nodes.find(n => n.name === edge.toName)
    if (!node) continue
    const key = `${node.filePath}:${node.name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name: node.name,
      filePath: node.filePath,
      relation: 'direct-render',
      confidence: 'confirmed',
    })
  }

  // 4. One-hop renders: components rendered by direct imports/renders
  const directFiles = new Set(result.map(r => r.filePath))
  for (const directFile of directFiles) {
    if (directFile === routeFilePath) continue
    const oneHopRenders = edges.filter(
      e => e.fromFile === directFile && e.relation === 'renders'
    )
    for (const edge of oneHopRenders) {
      const node = nodes.find(n => n.name === edge.toName)
      if (!node) continue
      const key = `${node.filePath}:${node.name}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        name: node.name,
        filePath: node.filePath,
        relation: 'one-hop-render',
        confidence: 'inferred',
      })
    }
  }

  // Sort: route-export first, then direct, then one-hop; within same relation, by renderCount
  const relationOrder: Record<string, number> = {
    'route-export': 0,
    'direct-import': 1,
    'direct-render': 2,
    'one-hop-render': 3,
  }
  result.sort((a, b) => {
    const diff = relationOrder[a.relation] - relationOrder[b.relation]
    if (diff !== 0) return diff
    const nodeA = nodes.find(n => n.name === a.name)
    const nodeB = nodes.find(n => n.name === b.name)
    return (nodeB?.renderCount ?? 0) - (nodeA?.renderCount ?? 0)
  })

  // Limit to 20 items
  return result.slice(0, 20)
}

// ─── Backend resolution ──────────────────────────────────────────────────────

interface ResolvedBackend {
  label: string
  filePath: string | null
  kind: 'api-route' | 'server-action' | 'supabase-function' | 'network-endpoint'
  relation: 'observed-request' | 'direct-import' | 'route-companion' | 'convention-match'
  confidence: 'confirmed' | 'inferred'
}

function resolveBackend(
  projectPath: string,
  pathname: string,
  routeFilePath: string | null,
  runtimeRequests: ResolvePageContextInput['runtimeRequests'],
  allRoutes: DiscoveredRoute[]
): ResolvedBackend[] {
  const result: ResolvedBackend[] = []
  const seen = new Set<string>()

  // 1. Runtime requests: same-origin /api/* calls
  if (runtimeRequests) {
    for (const req of runtimeRequests) {
      let requestPath: string
      try {
        const url = new URL(req.url, 'http://localhost')
        requestPath = url.pathname
      } catch {
        continue
      }

      // /api/* routes
      if (requestPath.startsWith('/api/')) {
        const matchingRoute = allRoutes.find(r =>
          r.type === 'api' && routePatternToRegex(r.path).test(requestPath)
        )

        const label = `${req.method ?? 'GET'} ${requestPath}`
        if (seen.has(label)) continue
        seen.add(label)

        result.push({
          label,
          filePath: matchingRoute?.filePath ?? null,
          kind: 'api-route',
          relation: 'observed-request',
          confidence: matchingRoute ? 'confirmed' : 'inferred',
        })
      }

      // Supabase Functions: /functions/v1/:name
      const supabaseMatch = requestPath.match(/^\/functions\/v1\/([^/]+)/)
      if (supabaseMatch) {
        const funcName = supabaseMatch[1]
        const funcPath = `supabase/functions/${funcName}/index.ts`
        const label = `Supabase Function: ${funcName}`
        if (seen.has(label)) continue
        seen.add(label)

        result.push({
          label,
          filePath: existsSync(join(projectPath, funcPath)) ? funcPath : null,
          kind: 'supabase-function',
          relation: 'observed-request',
          confidence: existsSync(join(projectPath, funcPath)) ? 'confirmed' : 'inferred',
        })
      }
    }
  }

  // 2. Route companion: route.ts in the same directory as the page file
  if (routeFilePath) {
    const routeDir = dirname(routeFilePath)
    const companionCandidates = ['route.ts', 'route.tsx', 'route.js']
    for (const candidate of companionCandidates) {
      const companionPath = join(routeDir, candidate)
      if (existsSync(join(projectPath, companionPath)) && companionPath !== routeFilePath) {
        const label = companionPath
        if (seen.has(label)) continue
        seen.add(label)

        result.push({
          label,
          filePath: companionPath,
          kind: 'api-route',
          relation: 'route-companion',
          confidence: 'inferred',
        })
      }
    }
  }

  return result
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ContextualScreenshotService {
  private routeService = new RouteDiscoveryService()
  private componentGraphService = new ComponentGraphService()

  resolvePageContext(input: ResolvePageContextInput): PageContextEvidence {
    const { projectPath, pageUrl, pageTitle, runtimeRequests } = input

    // Parse URL
    let pathname: string
    try {
      pathname = new URL(pageUrl).pathname
    } catch {
      pathname = '/'
    }

    // 1. Route resolution
    const routeMap = this.routeService.analyzeProject(projectPath)
    const ranked = rankRoutes(pathname, routeMap.routes)
    const bestMatch = ranked[0] ?? null

    const route: PageContextEvidence['route'] = {
      pathname,
      matchedPath: bestMatch?.route.path ?? null,
      filePath: bestMatch?.route.filePath ?? null,
      routeType: bestMatch?.route.type ?? null,
      framework: routeMap.framework,
      confidence: bestMatch
        ? (bestMatch.route.type === 'static' ? 'confirmed' : 'confirmed')
        : 'none',
    }

    // 2. Component resolution
    const graph = this.componentGraphService.analyzeProject(projectPath)
    const components = resolveComponents(
      bestMatch?.route.filePath ?? null,
      graph.nodes,
      graph.edges
    )

    // 3. Backend resolution
    const backend = resolveBackend(
      projectPath,
      pathname,
      bestMatch?.route.filePath ?? null,
      runtimeRequests,
      routeMap.routes
    )

    return {
      capturedAt: new Date().toISOString(),
      pageUrl,
      pageTitle: pageTitle ?? null,
      route,
      components,
      backend,
    }
  }
}
