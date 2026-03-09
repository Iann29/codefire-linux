import { RouteDiscoveryService } from '../../routes/RouteDiscoveryService'
import { DesignSystemService } from '../../design-system/DesignSystemService'
import { EnvDoctorService } from '../../EnvDoctorService'
import { ComponentGraphService } from '../../component-graph/ComponentGraphService'
import { LaunchGuardService } from '../../launch-guard/LaunchGuardService'
import { PreviewDiscoveryService } from '../../PreviewDiscoveryService'

import type { ComponentNode } from '../../component-graph/ComponentGraphService'

// ─── Result contract ────────────────────────────────────────────────────────

export interface WebProjectToolResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  meta?: Record<string, unknown>
  hints?: { suggestedNextTools?: string[] }
}

// ─── Caps ───────────────────────────────────────────────────────────────────

const MAX_ROUTES = 50
const MAX_INCONSISTENCIES = 10
const MAX_TOP_NAMESPACES = 10
const MAX_ENV_ISSUES = 20
const MAX_IMPORTED_BY = 20
const MAX_HOTSPOTS = 10
const MAX_LAUNCH_CHECKS = 20
const MAX_ENVIRONMENTS = 10

// ─── Service ────────────────────────────────────────────────────────────────

export class WebProjectToolService {
  private readonly routeDiscovery = new RouteDiscoveryService()
  private readonly designSystem = new DesignSystemService()
  private readonly envDoctorSvc = new EnvDoctorService()
  private readonly componentGraph = new ComponentGraphService()
  private readonly launchGuard = new LaunchGuardService()
  private readonly previewDiscovery = new PreviewDiscoveryService()

  // ── Route discovery ─────────────────────────────────────────────────────

  async discoverRoutes(projectPath: string): Promise<WebProjectToolResult> {
    try {
      const result = this.routeDiscovery.analyzeProject(projectPath)

      return {
        ok: true,
        data: {
          framework: result.framework,
          frameworkVersion: result.frameworkVersion ?? null,
          routeCount: result.routes.length,
          routes: result.routes.slice(0, MAX_ROUTES).map((r) => ({
            path: r.path,
            filePath: r.filePath,
            type: r.type,
          })),
          unsupported: result.unsupported,
        },
        hints: { suggestedNextTools: ['read_file', 'find_symbol'] },
      }
    } catch (err) {
      return { ok: false, error: `Service failed: ${errorMessage(err)}` }
    }
  }

  // ── Design system inspection ────────────────────────────────────────────

  async inspectDesignSystem(projectPath: string): Promise<WebProjectToolResult> {
    try {
      const snap = this.designSystem.analyzeProject(projectPath)

      // Group tokens by namespace and count
      const nsCounts = new Map<string, number>()
      for (const t of snap.tokens) {
        nsCounts.set(t.namespace, (nsCounts.get(t.namespace) ?? 0) + 1)
      }
      const topNamespaces = Array.from(nsCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TOP_NAMESPACES)
        .map(([namespace, count]) => ({ namespace, count }))

      return {
        ok: true,
        data: {
          framework: snap.framework,
          styleStack: snap.styleStack,
          tokenCount: snap.tokenCount,
          topNamespaces,
          inconsistencyCount: snap.inconsistencies.length,
          inconsistencies: snap.inconsistencies.slice(0, MAX_INCONSISTENCIES).map((i) => ({
            kind: i.kind,
            title: i.title,
            evidence: i.evidence,
          })),
        },
        hints: { suggestedNextTools: ['grep_files', 'read_file'] },
      }
    } catch (err) {
      return { ok: false, error: `Service failed: ${errorMessage(err)}` }
    }
  }

  // ── Env doctor ──────────────────────────────────────────────────────────

  async envDoctor(projectPath: string): Promise<WebProjectToolResult> {
    try {
      const report = this.envDoctorSvc.analyzeProject(projectPath)

      return {
        ok: true,
        data: {
          score: report.score,
          totalDefinitions: report.totalDefinitions,
          totalUsages: report.totalUsages,
          issueCount: report.issues.length,
          issues: report.issues.slice(0, MAX_ENV_ISSUES).map((i) => ({
            severity: i.severity,
            code: i.code,
            key: i.key,
            title: i.title,
            remediation: i.remediation,
          })),
        },
        hints: { suggestedNextTools: ['read_file', 'grep_files'] },
      }
    } catch (err) {
      return { ok: false, error: `Service failed: ${errorMessage(err)}` }
    }
  }

  // ── Component usage ─────────────────────────────────────────────────────

  async componentUsage(
    projectPath: string,
    opts: { name?: string; path?: string } = {},
  ): Promise<WebProjectToolResult> {
    try {
      const graph = this.componentGraph.analyzeProject(projectPath)

      const base = {
        totalComponents: graph.totalComponents,
        totalEdges: graph.totalEdges,
        entryPoints: graph.entryPoints,
      }

      // If a specific component was requested, find it and show its neighborhood
      if (opts.name || opts.path) {
        const node = this.findComponent(graph.nodes, opts)
        if (!node) {
          return {
            ok: true,
            data: {
              ...base,
              queriedComponent: null,
              message: `No component matching ${opts.name ? `name="${opts.name}"` : `path="${opts.path}"`} was found`,
            },
            hints: { suggestedNextTools: ['find_symbol', 'grep_files'] },
          }
        }

        const importedByEdges = graph.edges.filter(
          (e) => e.toName === node.name && (e.relation === 'imports' || e.relation === 're-exports'),
        )
        const rendersEdges = graph.edges.filter(
          (e) => e.fromFile === node.filePath && e.relation === 'renders',
        )

        return {
          ok: true,
          data: {
            ...base,
            queriedComponent: {
              name: node.name,
              filePath: node.filePath,
              importCount: node.importCount,
              renderCount: node.renderCount,
              importedBy: uniqueStrings(importedByEdges.map((e) => e.fromFile)).slice(0, MAX_IMPORTED_BY),
              renders: uniqueStrings(rendersEdges.map((e) => e.toName)),
            },
          },
          hints: { suggestedNextTools: ['find_references', 'read_file'] },
        }
      }

      // No filter: return overall stats + top hotspots
      const hotspots = graph.nodes
        .slice() // already sorted by importCount desc from the service
        .slice(0, MAX_HOTSPOTS)
        .map((n) => ({
          name: n.name,
          filePath: n.filePath,
          importCount: n.importCount,
          renderCount: n.renderCount,
        }))

      return {
        ok: true,
        data: { ...base, hotspots },
        hints: { suggestedNextTools: ['find_references', 'read_file'] },
      }
    } catch (err) {
      return { ok: false, error: `Service failed: ${errorMessage(err)}` }
    }
  }

  // ── Launch guard ────────────────────────────────────────────────────────

  async launchGuardSummary(
    projectPath: string,
    gitStatus?: {
      branch: string
      isClean: boolean
      files: Array<{ status: string; path: string }>
    },
  ): Promise<WebProjectToolResult> {
    try {
      // Run subsidiary analyses to feed the guard
      const envResult = this.envDoctorSvc.analyzeProject(projectPath)
      const routeResult = this.routeDiscovery.analyzeProject(projectPath)

      const report = this.launchGuard.generateReport({
        projectPath,
        gitStatus,
        envDoctorResult: {
          score: envResult.score,
          issues: envResult.issues.map((i) => ({
            severity: i.severity,
            code: i.code,
            key: i.key,
            title: i.title,
          })),
        },
        routeResult: {
          routes: routeResult.routes.map((r) => ({
            path: r.path,
            type: r.type,
          })),
        },
      })

      return {
        ok: true,
        data: {
          score: report.score,
          branch: report.branch,
          totalChecks: report.totalChecks,
          passCount: report.passCount,
          warnCount: report.warnCount,
          failCount: report.failCount,
          skipCount: report.skipCount,
          checks: report.checks.slice(0, MAX_LAUNCH_CHECKS).map((c) => ({
            id: c.id,
            category: c.category,
            status: c.status,
            title: c.title,
            evidence: c.evidence,
          })),
        },
        hints: { suggestedNextTools: ['env_doctor', 'discover_routes', 'git_status'] },
      }
    } catch (err) {
      return { ok: false, error: `Service failed: ${errorMessage(err)}` }
    }
  }

  // ── Preview discovery ───────────────────────────────────────────────────

  async discoverPreviews(
    projectPath: string,
    gitInfo?: { branch: string; isClean: boolean },
  ): Promise<WebProjectToolResult> {
    try {
      const result = this.previewDiscovery.discoverEnvironments(projectPath, gitInfo)

      return {
        ok: true,
        data: {
          provider: result.provider,
          currentBranch: result.currentBranch,
          productionUrl: result.productionUrl,
          environments: result.environments.slice(0, MAX_ENVIRONMENTS).map((e) => ({
            id: e.id,
            branch: e.branch,
            previewUrl: e.previewUrl,
            productionUrl: e.productionUrl,
            status: e.status,
            source: e.source,
            prNumber: e.prNumber,
            prTitle: e.prTitle,
          })),
        },
        hints: { suggestedNextTools: ['browser_navigate', 'discover_routes'] },
      }
    } catch (err) {
      return { ok: false, error: `Service failed: ${errorMessage(err)}` }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private findComponent(
    nodes: ComponentNode[],
    opts: { name?: string; path?: string },
  ): ComponentNode | undefined {
    if (opts.name) {
      // Exact name match first, then case-insensitive
      return (
        nodes.find((n) => n.name === opts.name) ??
        nodes.find((n) => n.name.toLowerCase() === opts.name!.toLowerCase())
      )
    }
    if (opts.path) {
      // Substring match on file path
      return nodes.find((n) => n.filePath.includes(opts.path!))
    }
    return undefined
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
