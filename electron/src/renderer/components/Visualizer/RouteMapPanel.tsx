import { useState, useEffect, useCallback } from 'react'
import { Map, RefreshCw, FileCode, AlertCircle, Navigation, Globe, Zap, Layers } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface DiscoveredRoute {
  path: string
  filePath: string
  type: 'static' | 'dynamic' | 'api' | 'catch-all' | 'unknown'
  framework: string
  source: string
}

interface RouteMapResult {
  framework: string | null
  frameworkVersion?: string
  routes: DiscoveredRoute[]
  unsupported: boolean
  generatedAt: number
}

const FRAMEWORK_LABELS: Record<string, { label: string; color: string }> = {
  'nextjs-app': { label: 'Next.js App Router', color: 'bg-white/10 text-white' },
  'nextjs-pages': { label: 'Next.js Pages Router', color: 'bg-white/10 text-white' },
  'react-router': { label: 'React Router', color: 'bg-sky-500/20 text-sky-400' },
  'astro': { label: 'Astro', color: 'bg-orange-500/20 text-orange-400' },
  'vite-spa': { label: 'Vite SPA', color: 'bg-purple-500/20 text-purple-400' },
}

const TYPE_BADGES: Record<string, { label: string; color: string; icon: typeof Globe }> = {
  static: { label: 'Static', color: 'bg-emerald-500/20 text-emerald-400', icon: Globe },
  dynamic: { label: 'Dynamic', color: 'bg-blue-500/20 text-blue-400', icon: Zap },
  api: { label: 'API', color: 'bg-purple-500/20 text-purple-400', icon: Navigation },
  'catch-all': { label: 'Catch-All', color: 'bg-amber-500/20 text-amber-400', icon: Layers },
  unknown: { label: 'Unknown', color: 'bg-neutral-500/20 text-neutral-400', icon: AlertCircle },
}

interface RouteMapPanelProps {
  projectPath: string
}

export default function RouteMapPanel({ projectPath }: RouteMapPanelProps) {
  const [result, setResult] = useState<RouteMapResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const discover = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.routes.discover(projectPath)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover routes')
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    discover()
  }, [discover])

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading && !result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <RefreshCw size={24} className="text-neutral-600 animate-spin mb-3" />
        <p className="text-xs text-neutral-500">Discovering routes...</p>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <AlertCircle size={32} className="text-red-500/60 mb-3" />
        <p className="text-xs text-red-400 mb-3">{error}</p>
        <button
          onClick={discover}
          className="text-xs px-3 py-1.5 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // ── Unsupported / no framework ────────────────────────────────────────────
  if (!result || result.unsupported || !result.framework) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <Map size={40} className="text-neutral-700 mb-4" />
        <h3 className="text-sm font-medium text-neutral-400 mb-1">No Routes Detected</h3>
        <p className="text-xs text-neutral-600 max-w-xs mb-4">
          Could not detect a supported framework. Supported: Next.js, React Router, Astro, Vite.
        </p>
        <button
          onClick={discover}
          className="text-xs px-3 py-1.5 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={12} />
          Rescan
        </button>
      </div>
    )
  }

  // ── Route list ────────────────────────────────────────────────────────────
  const fw = FRAMEWORK_LABELS[result.framework] || { label: result.framework, color: 'bg-neutral-700 text-neutral-300' }

  const counts = {
    static: result.routes.filter((r) => r.type === 'static').length,
    dynamic: result.routes.filter((r) => r.type === 'dynamic').length,
    api: result.routes.filter((r) => r.type === 'api').length,
    catchAll: result.routes.filter((r) => r.type === 'catch-all').length,
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${fw.color}`}>
            {fw.label}
            {result.frameworkVersion && (
              <span className="ml-1 opacity-60">v{result.frameworkVersion}</span>
            )}
          </span>
          <span className="text-[10px] text-neutral-600">
            {result.routes.length} route{result.routes.length !== 1 ? 's' : ''}
          </span>

          {/* Type counts */}
          <div className="flex items-center gap-2 ml-2">
            {counts.static > 0 && (
              <span className="text-[10px] text-emerald-500/70">{counts.static} static</span>
            )}
            {counts.dynamic > 0 && (
              <span className="text-[10px] text-blue-400/70">{counts.dynamic} dynamic</span>
            )}
            {counts.api > 0 && (
              <span className="text-[10px] text-purple-400/70">{counts.api} api</span>
            )}
            {counts.catchAll > 0 && (
              <span className="text-[10px] text-amber-400/70">{counts.catchAll} catch-all</span>
            )}
          </div>
        </div>

        <button
          onClick={discover}
          disabled={loading}
          className="text-neutral-500 hover:text-neutral-300 transition-colors p-1 rounded hover:bg-neutral-800"
          title="Rescan routes"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Route table */}
      <div className="flex-1 overflow-y-auto">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_90px_1fr] gap-2 px-4 py-1.5 text-[10px] text-neutral-600 uppercase tracking-wider border-b border-neutral-800/50 sticky top-0 bg-neutral-950 z-10">
          <span>Path</span>
          <span>Type</span>
          <span>Source File</span>
        </div>

        {/* Rows */}
        {result.routes.map((route, i) => {
          const badge = TYPE_BADGES[route.type] || TYPE_BADGES.unknown
          const BadgeIcon = badge.icon

          return (
            <div
              key={`${route.path}-${i}`}
              className="grid grid-cols-[1fr_90px_1fr] gap-2 px-4 py-1.5 text-xs border-b border-neutral-800/30 hover:bg-neutral-800/30 transition-colors group"
            >
              {/* Path */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-neutral-200 truncate">{route.path}</span>
              </div>

              {/* Type badge */}
              <div className="flex items-center">
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${badge.color}`}>
                  <BadgeIcon size={10} />
                  {badge.label}
                </span>
              </div>

              {/* Source file */}
              <div className="flex items-center gap-1.5 min-w-0 text-neutral-500 group-hover:text-neutral-400 transition-colors">
                <FileCode size={11} className="shrink-0" />
                <span className="font-mono text-[11px] truncate">{route.filePath}</span>
              </div>
            </div>
          )
        })}

        {result.routes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Map size={28} className="text-neutral-700 mb-2" />
            <p className="text-xs text-neutral-600">
              Framework detected but no routes found.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
