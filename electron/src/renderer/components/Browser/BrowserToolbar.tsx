import { ArrowLeft, ArrowRight, RotateCw, Home, Camera, Bug, Trash2 } from 'lucide-react'
import { useState, useEffect, type KeyboardEvent } from 'react'
import { normalizeAddress } from './normalizeAddress'

interface BrowserToolbarProps {
  url: string
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onScreenshot: () => void
  onCaptureIssue?: () => void
  onClearSession?: () => void
  canGoBack: boolean
  canGoForward: boolean
}

export default function BrowserToolbar({
  url,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onScreenshot,
  onCaptureIssue,
  onClearSession,
  canGoBack,
  canGoForward,
}: BrowserToolbarProps) {
  const [inputUrl, setInputUrl] = useState(url)
  const [error, setError] = useState('')

  useEffect(() => {
    setInputUrl(url)
  }, [url])

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

        <button type="button" onClick={onScreenshot} className={btnClass} title="Screenshot">
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
