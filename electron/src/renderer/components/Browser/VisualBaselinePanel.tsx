import { useState, useCallback, useEffect } from 'react'
import {
  Camera,
  GitCompare,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  X,
  RefreshCw,
  ThumbsUp,
} from 'lucide-react'
import { api } from '@renderer/lib/api'
import type { VisualBaseline } from '@shared/models'

interface VisualBaselinePanelProps {
  projectId: string
  currentUrl: string
  viewportWidth: number
  viewportHeight: number
  getActiveWebview: () => any
  onClose: () => void
}

interface ComparisonResult {
  baselineDataUrl: string
  currentDataUrl: string
  diffDataUrl: string
  diffPercent: number
  comparisonId: number
  baselineId: number
  status: string
}

export default function VisualBaselinePanel({
  projectId,
  currentUrl,
  viewportWidth,
  viewportHeight,
  getActiveWebview,
  onClose,
}: VisualBaselinePanelProps) {
  const [baselines, setBaselines] = useState<VisualBaseline[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [comparing, setComparing] = useState<number | null>(null)
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [viewMode, setViewMode] = useState<'side-by-side' | 'diff'>('side-by-side')
  const [label, setLabel] = useState('')

  const routeKey = currentUrl
    ? new URL(currentUrl).pathname.replace(/\/$/, '') || '/'
    : '/'

  const loadBaselines = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const list = await api.visualBaselines.list(projectId)
      setBaselines(list)
    } catch (err) {
      console.error('Failed to load baselines:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadBaselines()
  }, [loadBaselines])

  const saveBaseline = useCallback(async () => {
    const wv = getActiveWebview()
    if (!wv || !currentUrl) return

    setSaving(true)
    try {
      const img = await wv.capturePage()
      const imageDataUrl = img.toDataURL()

      await api.visualBaselines.save({
        projectId,
        routeKey,
        pageUrl: currentUrl,
        viewportWidth,
        viewportHeight,
        label: label || undefined,
        imageDataUrl,
      })

      setLabel('')
      await loadBaselines()
    } catch (err) {
      console.error('Failed to save baseline:', err)
    } finally {
      setSaving(false)
    }
  }, [getActiveWebview, currentUrl, projectId, routeKey, viewportWidth, viewportHeight, label, loadBaselines])

  const compareWithBaseline = useCallback(async (baseline: VisualBaseline) => {
    const wv = getActiveWebview()
    if (!wv) return

    setComparing(baseline.id)
    setComparison(null)
    try {
      const img = await wv.capturePage()
      const currentImageDataUrl = img.toDataURL()

      const result = await api.visualBaselines.compare({
        baselineId: baseline.id,
        projectId,
        currentImageDataUrl,
      })

      if (result.error) {
        console.error('Compare failed:', result.error)
        return
      }

      setComparison({
        baselineDataUrl: result.baselineDataUrl,
        currentDataUrl: result.currentDataUrl,
        diffDataUrl: result.diffDataUrl,
        diffPercent: result.comparison.diffPercent,
        comparisonId: result.comparison.id,
        baselineId: baseline.id,
        status: result.comparison.status,
      })
    } catch (err) {
      console.error('Compare failed:', err)
    } finally {
      setComparing(null)
    }
  }, [getActiveWebview, projectId])

  const approveBaseline = useCallback(async () => {
    if (!comparison) return
    try {
      await api.visualBaselines.approve({
        comparisonId: comparison.comparisonId,
        baselineId: comparison.baselineId,
      })
      setComparison(null)
      await loadBaselines()
    } catch (err) {
      console.error('Approve failed:', err)
    }
  }, [comparison, loadBaselines])

  const deleteBaseline = useCallback(async (id: number) => {
    try {
      await api.visualBaselines.delete(id)
      await loadBaselines()
      if (comparison?.baselineId === id) {
        setComparison(null)
      }
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }, [loadBaselines, comparison])

  const diffColor = (percent: number) => {
    if (percent < 0.1) return 'text-green-400'
    if (percent < 5) return 'text-yellow-400'
    return 'text-red-400'
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 size={14} className="text-green-400" />
      case 'failed':
        return <XCircle size={14} className="text-red-400" />
      case 'approved':
        return <ThumbsUp size={14} className="text-blue-400" />
      default:
        return <AlertTriangle size={14} className="text-yellow-400" />
    }
  }

  return (
    <div className="flex flex-col border-t border-neutral-800 bg-neutral-950 max-h-[60vh] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2">
          <Camera size={14} className="text-codefire-orange" />
          <span className="text-xs font-medium text-neutral-300">Visual Baselines</span>
          <span className="text-[10px] text-neutral-600">
            {routeKey} | {viewportWidth}x{viewportHeight}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-600 hover:text-neutral-400 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {/* Save new baseline */}
        <div className="flex items-center gap-2 bg-neutral-900 rounded border border-neutral-800 p-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded text-neutral-200 outline-none focus:border-codefire-orange/50"
            placeholder="Label (optional, e.g. 'Homepage hero v2')"
          />
          <button
            type="button"
            onClick={saveBaseline}
            disabled={saving || !currentUrl || currentUrl === 'about:blank'}
            className="flex items-center gap-1 px-3 py-1 text-[10px] rounded bg-codefire-orange text-white hover:bg-codefire-orange/80 transition-colors disabled:opacity-50 shrink-0"
          >
            <Camera size={10} />
            {saving ? 'Saving...' : 'Save Baseline'}
          </button>
        </div>

        {/* Comparison View */}
        {comparison && (
          <div className="bg-neutral-900 rounded border border-neutral-800 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {statusIcon(comparison.status)}
                <span className="text-xs text-neutral-300">Comparison Result</span>
                <span className={`text-xs font-mono font-bold ${diffColor(comparison.diffPercent)}`}>
                  {comparison.diffPercent.toFixed(2)}% diff
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setViewMode('side-by-side')}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    viewMode === 'side-by-side'
                      ? 'bg-codefire-orange/20 text-codefire-orange'
                      : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Side by Side
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    viewMode === 'diff'
                      ? 'bg-codefire-orange/20 text-codefire-orange'
                      : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Diff Only
                </button>
                {comparison.status !== 'passed' && (
                  <button
                    type="button"
                    onClick={approveBaseline}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors"
                  >
                    <ThumbsUp size={10} />
                    Approve as New Baseline
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setComparison(null)}
                  className="text-neutral-600 hover:text-neutral-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {viewMode === 'side-by-side' ? (
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <div className="text-[10px] text-neutral-500 mb-0.5 text-center">Baseline</div>
                  <img
                    src={comparison.baselineDataUrl}
                    alt="Baseline"
                    className="w-full rounded border border-neutral-700"
                  />
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 mb-0.5 text-center">Current</div>
                  <img
                    src={comparison.currentDataUrl}
                    alt="Current"
                    className="w-full rounded border border-neutral-700"
                  />
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 mb-0.5 text-center">Diff</div>
                  <img
                    src={comparison.diffDataUrl}
                    alt="Diff"
                    className="w-full rounded border border-neutral-700"
                  />
                </div>
              </div>
            ) : (
              <div>
                <img
                  src={comparison.diffDataUrl}
                  alt="Diff"
                  className="w-full max-h-64 object-contain rounded border border-neutral-700"
                />
              </div>
            )}
          </div>
        )}

        {/* Baselines List */}
        {baselines.length > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
                Saved Baselines ({baselines.length})
              </div>
              <button
                type="button"
                onClick={loadBaselines}
                className="text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {baselines.map((baseline) => (
              <div
                key={baseline.id}
                className="flex items-center gap-2 px-2 py-1.5 bg-neutral-900 rounded border border-neutral-800"
              >
                <Eye size={12} className="text-neutral-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-neutral-300 truncate">
                    {baseline.label || baseline.routeKey}
                  </div>
                  <div className="text-[10px] text-neutral-600">
                    {baseline.viewportWidth}x{baseline.viewportHeight} | {new Date(baseline.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => compareWithBaseline(baseline)}
                  disabled={comparing === baseline.id}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-colors disabled:opacity-50 shrink-0"
                >
                  <GitCompare size={10} />
                  {comparing === baseline.id ? 'Comparing...' : 'Compare'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteBaseline(baseline.id)}
                  className="text-neutral-600 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          !loading && (
            <div className="flex flex-col items-center justify-center py-6 text-neutral-600">
              <Camera size={24} className="mb-2 opacity-50" />
              <p className="text-xs">No baselines saved yet</p>
              <p className="text-[10px] text-neutral-700">
                Save the current page as a visual baseline to start tracking changes
              </p>
            </div>
          )
        )}

        {loading && (
          <div className="text-center text-[10px] text-neutral-600 py-4">Loading baselines...</div>
        )}
      </div>
    </div>
  )
}
