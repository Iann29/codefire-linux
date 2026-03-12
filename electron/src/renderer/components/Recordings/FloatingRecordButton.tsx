import { Mic, Square } from 'lucide-react'
import { useState, useCallback, useRef } from 'react'
import { useGlobalRecording } from '@renderer/hooks/useGlobalRecording'
import { api } from '@renderer/lib/api'

interface FloatingRecordButtonProps {
  projectId: string
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function FloatingRecordButton({ projectId }: FloatingRecordButtonProps) {
  const { isRecording, duration, startRecording, stopRecording } = useGlobalRecording()
  const [saving, setSaving] = useState(false)
  const durationRef = useRef(0)
  durationRef.current = duration

  const handleClick = useCallback(async () => {
    if (isRecording) {
      const capturedDuration = durationRef.current
      setSaving(true)
      try {
        const blob = await stopRecording()
        if (blob) {
          const title = `Recording ${new Date().toLocaleString()}`
          const recording = await api.recordings.create({ projectId, title })
          const arrayBuffer = await blob.arrayBuffer()
          await api.recordings.saveAudio(recording.id, arrayBuffer)
          await api.recordings.update(recording.id, {
            status: 'recorded',
            duration: capturedDuration,
          })
          // Notify RecordingsView (if mounted) to refresh its list
          window.dispatchEvent(new CustomEvent('recording-saved'))
        }
      } catch (err) {
        console.error('Failed to save recording:', err)
      }
      setSaving(false)
    } else {
      try {
        await startRecording(false)
      } catch (err) {
        console.error('Failed to start recording:', err)
      }
    }
  }, [isRecording, startRecording, stopRecording, projectId])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className={`
        fixed bottom-12 left-1/2 -translate-x-1/2 z-50
        flex items-center gap-2 rounded-full shadow-lg shadow-black/30
        transition-all duration-200 select-none no-drag
        ${
          isRecording
            ? 'bg-red-500/90 hover:bg-red-500 text-white px-4 py-2.5 animate-recording-pulse'
            : 'bg-neutral-800/80 hover:bg-neutral-700/90 text-neutral-400 hover:text-white p-3 backdrop-blur-sm border border-neutral-700/50'
        }
        ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      title={isRecording ? 'Stop recording and save' : 'Start recording'}
    >
      {isRecording ? (
        <>
          <Square size={14} fill="currentColor" />
          <span className="text-sm font-mono font-medium tabular-nums">
            {formatDuration(duration)}
          </span>
        </>
      ) : (
        <Mic size={18} />
      )}
    </button>
  )
}
