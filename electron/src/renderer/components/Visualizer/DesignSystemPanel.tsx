import { useState, useEffect } from 'react'
import { Loader2, Palette, Type, Square, Layers, AlertTriangle } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface DesignSystemPanelProps {
  projectPath: string
}

type TokenKind = 'color' | 'spacing' | 'radius' | 'shadow' | 'typography' | 'z-index' | 'other'

interface DesignToken {
  kind: string
  name: string
  value: string
  normalizedValue: string
  namespace: string
  sourceFile: string
  sourceLine: number
  sourceType: string
}

interface Inconsistency {
  kind: string
  title: string
  tokens: string[]
  evidence: string
}

interface Snapshot {
  generatedAt: number
  framework: string | null
  tokenCount: number
  tokens: DesignToken[]
  styleStack: string[]
  inconsistencies: Inconsistency[]
}

const KIND_ICONS: Record<string, typeof Palette> = {
  color: Palette,
  typography: Type,
  spacing: Square,
  radius: Square,
  shadow: Layers,
}

const KIND_COLORS: Record<string, string> = {
  color: 'text-pink-400',
  spacing: 'text-blue-400',
  radius: 'text-green-400',
  shadow: 'text-purple-400',
  typography: 'text-orange-400',
  'z-index': 'text-yellow-400',
  other: 'text-neutral-400',
}

export default function DesignSystemPanel({ projectPath }: DesignSystemPanelProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterKind, setFilterKind] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)

  async function analyze() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.designSystem.analyze(projectPath)
      setSnapshot(result)
    } catch (err: any) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    analyze()
  }, [projectPath])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
        <span className="ml-2 text-sm text-neutral-500">Analyzing design system...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  if (!snapshot) return null

  const kinds = Array.from(new Set(snapshot.tokens.map(t => t.kind)))
  const filteredTokens = filterKind === 'all'
    ? snapshot.tokens
    : snapshot.tokens.filter(t => t.kind === filterKind)

  const kindCounts = kinds.reduce((acc, k) => {
    acc[k] = snapshot.tokens.filter(t => t.kind === k).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header stats */}
      <div className="px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {snapshot.framework && (
            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
              {snapshot.framework}
            </span>
          )}
          {snapshot.styleStack.map(s => (
            <span key={s} className="text-xs bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded">
              {s}
            </span>
          ))}
          <span className="text-xs text-neutral-500 ml-auto">
            {snapshot.tokenCount} tokens
          </span>
          <button
            onClick={analyze}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Kind filters */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-neutral-800 shrink-0 overflow-x-auto">
        <button
          onClick={() => setFilterKind('all')}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            filterKind === 'all' ? 'bg-neutral-700 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          All ({snapshot.tokenCount})
        </button>
        {kinds.map(k => (
          <button
            key={k}
            onClick={() => setFilterKind(k as TokenKind)}
            className={`text-xs px-2 py-1 rounded transition-colors capitalize ${
              filterKind === k ? 'bg-neutral-700 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {k} ({kindCounts[k]})
          </button>
        ))}
      </div>

      {/* Token list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {filteredTokens.length === 0 ? (
          <p className="text-xs text-neutral-600 text-center py-8">No tokens found</p>
        ) : (
          <div className="space-y-1">
            {filteredTokens.map((token, i) => (
              <div key={`${token.name}-${i}`} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-neutral-800/50 group">
                {/* Color swatch for color tokens */}
                {token.kind === 'color' && /^(#|rgb|hsl|oklch)/.test(token.value) ? (
                  <div
                    className="w-4 h-4 rounded border border-neutral-700 shrink-0"
                    style={{ backgroundColor: token.value }}
                  />
                ) : (
                  <div className={`shrink-0 ${KIND_COLORS[token.kind] || 'text-neutral-500'}`}>
                    {(() => {
                      const Icon = KIND_ICONS[token.kind] || Square
                      return <Icon size={14} />
                    })()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-neutral-200 font-mono truncate">{token.name}</p>
                  <p className="text-[10px] text-neutral-500 truncate">{token.value}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-neutral-600 truncate max-w-[120px]">{token.sourceFile}</p>
                  <p className="text-[10px] text-neutral-700">{token.namespace}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Inconsistencies section */}
        {snapshot.inconsistencies.length > 0 && (
          <div className="mt-4 border-t border-neutral-800 pt-3">
            <h4 className="text-xs font-medium text-amber-400 flex items-center gap-1.5 mb-2">
              <AlertTriangle size={12} />
              Inconsistencies ({snapshot.inconsistencies.length})
            </h4>
            <div className="space-y-2">
              {snapshot.inconsistencies.map((inc, i) => (
                <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded p-2">
                  <p className="text-xs text-amber-300">{inc.title}</p>
                  <p className="text-[10px] text-neutral-500 mt-1">{inc.evidence}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
