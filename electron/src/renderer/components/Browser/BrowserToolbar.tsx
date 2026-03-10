import { ArrowLeft, ArrowRight, RotateCw, Home, Camera, Bug, Trash2, Monitor, Smartphone, Tablet, Laptop, ChevronDown, RotateCcw, ScanEye, Loader2 } from 'lucide-react'
import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { normalizeAddress } from './normalizeAddress'
import { VIEWPORT_PRESETS, type ViewportPreset } from './viewportPresets'

interface BrowserToolbarProps {
  url: string
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onScreenshot: () => void
  onContextShot?: () => void
  contextShotLoading?: boolean
  onCaptureIssue?: () => void
  onClearSession?: () => void
  canGoBack: boolean
  canGoForward: boolean
  viewportPresetId: string
  viewportWidth: number
  viewportHeight: number
  onViewportChange: (presetId: string, width: number, height: number) => void
}

const CATEGORY_ICON: Record<ViewportPreset['category'], typeof Monitor> = {
  mobile: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: Monitor,
}

const CATEGORY_LABELS: Record<ViewportPreset['category'], string> = {
  mobile: 'Mobile',
  tablet: 'Tablet',
  laptop: 'Laptop',
  desktop: 'Desktop',
}

const CATEGORY_ORDER: ViewportPreset['category'][] = ['mobile', 'tablet', 'laptop', 'desktop']

export default function BrowserToolbar({
  url,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onScreenshot,
  onContextShot,
  contextShotLoading,
  onCaptureIssue,
  onClearSession,
  canGoBack,
  canGoForward,
  viewportPresetId,
  viewportWidth,
  viewportHeight,
  onViewportChange,
}: BrowserToolbarProps) {
  const [inputUrl, setInputUrl] = useState(url)
  const [error, setError] = useState('')
  const [showViewportMenu, setShowViewportMenu] = useState(false)
  const [isLandscape, setIsLandscape] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInputUrl(url)
  }, [url])

  // Close menu on outside click
  useEffect(() => {
    if (!showViewportMenu) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowViewportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showViewportMenu])

  // Reset landscape when preset changes
  useEffect(() => {
    setIsLandscape(false)
  }, [viewportPresetId])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      setError('')
      const result = normalizeAddress(inputUrl)

      switch (result.kind) {
        case 'noop':
          return
        case 'invalid':
          setError(result.reason)
          return
        case 'url':
        case 'search':
          setInputUrl(result.url)
          onNavigate(result.url)
          return
      }
    }
  }

  function handlePresetSelect(preset: ViewportPreset) {
    const w = isLandscape ? preset.height : preset.width
    const h = isLandscape ? preset.width : preset.height
    onViewportChange(preset.id, w, h)
    setShowViewportMenu(false)
  }

  function handleToggleLandscape() {
    const newLandscape = !isLandscape
    setIsLandscape(newLandscape)
    // Swap current dimensions
    onViewportChange(viewportPresetId, viewportHeight, viewportWidth)
  }

  const currentPreset = VIEWPORT_PRESETS.find(p => p.id === viewportPresetId)
  const CurrentIcon = currentPreset ? CATEGORY_ICON[currentPreset.category] : Monitor

  // Group presets by category
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    Icon: CATEGORY_ICON[cat],
    presets: VIEWPORT_PRESETS.filter(p => p.category === cat),
  })).filter(g => g.presets.length > 0)

  const btnClass =
    'p-1.5 text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-neutral-900">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" onClick={onBack} disabled={!canGoBack} className={btnClass}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" onClick={onForward} disabled={!canGoForward} className={btnClass}>
          <ArrowRight size={14} />
        </button>
        <button type="button" onClick={onReload} className={btnClass}>
          <RotateCw size={14} />
        </button>
        <button type="button" onClick={() => onNavigate('about:blank')} className={btnClass}>
          <Home size={14} />
        </button>

        <input
          type="text"
          value={inputUrl}
          onChange={(e) => { setInputUrl(e.target.value); setError('') }}
          onKeyDown={handleKeyDown}
          className={`flex-1 bg-neutral-800 border rounded px-3 py-1 text-xs text-neutral-200 font-mono placeholder:text-neutral-600 focus:outline-none ${
            error ? 'border-red-500/50' : 'border-neutral-700 focus:border-codefire-orange/50'
          }`}
          placeholder="Enter URL or search..."
        />

        {/* Viewport selector */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setShowViewportMenu(!showViewportMenu)}
            className="flex items-center gap-1 px-2 py-1 text-neutral-500 hover:text-neutral-300 transition-colors rounded hover:bg-neutral-800"
            title="Viewport size"
          >
            <CurrentIcon size={13} />
            <span className="text-[10px] font-mono tabular-nums">
              {viewportWidth}x{viewportHeight}
            </span>
            <ChevronDown size={10} />
          </button>

          {showViewportMenu && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
              {/* Landscape toggle */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-700">
                <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Viewport</span>
                <button
                  type="button"
                  onClick={handleToggleLandscape}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                    isLandscape
                      ? 'text-codefire-orange bg-codefire-orange/10'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                  title={isLandscape ? 'Switch to portrait' : 'Switch to landscape'}
                >
                  <RotateCcw size={10} />
                  {isLandscape ? 'Landscape' : 'Portrait'}
                </button>
              </div>

              {grouped.map((group) => (
                <div key={group.category}>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 mt-0.5">
                    <group.Icon size={11} className="text-neutral-500" />
                    <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">
                      {group.label}
                    </span>
                  </div>
                  {group.presets.map((preset) => {
                    const isActive = preset.id === viewportPresetId
                    const displayW = isLandscape ? preset.height : preset.width
                    const displayH = isLandscape ? preset.width : preset.height
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePresetSelect(preset)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                          isActive
                            ? 'text-codefire-orange bg-codefire-orange/10'
                            : 'text-neutral-300 hover:bg-neutral-700/50'
                        }`}
                      >
                        <span className="truncate">{preset.label}</span>
                        <span className="text-[10px] font-mono tabular-nums text-neutral-500 ml-2">
                          {displayW}x{displayH}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Context Shot (primary) */}
        {onContextShot && (
          <button
            type="button"
            onClick={onContextShot}
            disabled={contextShotLoading}
            className={`${btnClass} ${contextShotLoading ? 'animate-pulse text-codefire-orange' : ''}`}
            title="Context Shot"
          >
            {contextShotLoading ? <Loader2 size={14} className="animate-spin" /> : <ScanEye size={14} />}
          </button>
        )}
        {/* Raw Shot (secondary) */}
        <button type="button" onClick={onScreenshot} className={btnClass} title="Raw Screenshot">
          <Camera size={14} />
        </button>
        {onCaptureIssue && (
          <button type="button" onClick={onCaptureIssue} className={btnClass} title="Capture Issue">
            <Bug size={14} />
          </button>
        )}
        {onClearSession && (
          <button type="button" onClick={onClearSession} className={btnClass} title="Clear Session">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {error && (
        <div className="px-3 pb-1.5 text-[10px] text-red-400">{error}</div>
      )}
    </div>
  )
}
