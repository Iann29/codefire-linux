import { Mic, Square, Loader2, Radio } from 'lucide-react'
import { useState } from 'react'
import { useRecorder } from '@renderer/hooks/useRecorder'

interface RecordingBarProps {
  onRecordingComplete: (blob: Blob, title: string) => void
  onRecordingStart?: (enableLive: boolean) => void
  onRecordingStop?: () => void
  liveTranscript?: string
  liveEnabled?: boolean
  onLiveToggle?: (enabled: boolean) => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RecordingBar({
  onRecordingComplete,
  onRecordingStart,
  onRecordingStop,
  liveTranscript,
  liveEnabled = false,
  onLiveToggle,
}: RecordingBarProps) {
  const { isRecording, duration, startRecording, stopRecording } = useRecorder()
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)

  async function handleStart() {
    setStarting(true)
    try {
      onRecordingStart?.(liveEnabled)
      await startRecording(liveEnabled)
    } catch (err) {
      console.error('Failed to start recording:', err)
    }
    setStarting(false)
  }

  async function handleStop() {
    onRecordingStop?.()
    const blob = await stopRecording()
    if (blob) {
      const recordingTitle = title.trim() || `Recording ${new Date().toLocaleString()}`
      onRecordingComplete(blob, recordingTitle)
      setTitle('')
    }
  }

  return (
    <div className="border-b border-neutral-800 bg-neutral-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Recording title..."
          disabled={isRecording}
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange/50 disabled:opacity-50"
        />

        {/* Live toggle — only shown when not recording */}
        {!isRecording && (
          <button
            type="button"
            onClick={() => onLiveToggle?.(!liveEnabled)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
              liveEnabled
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-400'
            }`}
            title={liveEnabled ? 'Live transcription ON' : 'Live transcription OFF'}
          >
            <Radio size={12} />
            Live
          </button>
        )}

        {isRecording ? (
          <>
            {liveEnabled && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <Radio size={10} className="animate-pulse" />
                LIVE
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono text-red-400">
                {formatDuration(duration)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-sm transition-colors"
            >
              <Square size={14} />
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 rounded text-sm transition-colors disabled:opacity-50"
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
            Record
          </button>
        )}
      </div>

      {/* Live transcript overlay — shown during recording with live enabled */}
      {isRecording && liveEnabled && liveTranscript && (
        <div className="px-4 pb-3">
          <div className="bg-neutral-800/50 border border-neutral-700/50 rounded p-2.5 max-h-24 overflow-y-auto">
            <p className="text-xs text-neutral-300 leading-relaxed">
              {liveTranscript}
              <span className="inline-block w-1.5 h-3 bg-green-400/60 ml-0.5 animate-pulse" />
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
