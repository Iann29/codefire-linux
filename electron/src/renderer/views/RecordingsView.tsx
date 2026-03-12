import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '@renderer/lib/api'
import type { Recording } from '@shared/models'
import RecordingBar from '@renderer/components/Recordings/RecordingBar'
import RecordingsList from '@renderer/components/Recordings/RecordingsList'
import RecordingDetail from '@renderer/components/Recordings/RecordingDetail'

interface RecordingsViewProps {
  projectId: string
}

export default function RecordingsView({ projectId }: RecordingsViewProps) {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selected, setSelected] = useState<Recording | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)

  // Live transcription state
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const liveSessionActive = useRef(false)
  const liveCleanups = useRef<Array<() => void>>([])

  useEffect(() => {
    api.recordings.list(projectId).then((recs) => {
      setRecordings(recs)
      if (recs.length > 0) setSelected(recs[0])
    })
  }, [projectId])

  // Cleanup live transcription listeners on unmount
  useEffect(() => {
    return () => {
      for (const cleanup of liveCleanups.current) cleanup()
      liveCleanups.current = []
    }
  }, [])

  const handleRecordingStart = useCallback(async (enableLive: boolean) => {
    if (!enableLive) return

    setLiveTranscript('')
    liveSessionActive.current = true

    try {
      await window.api.invoke('recordings:startLiveTranscribe' as never)

      // Listen for live transcription events
      const offTranscript = window.api.on('recordings:liveTranscript', (text: unknown) => {
        if (typeof text === 'string') {
          setLiveTranscript(text)
        }
      })

      const offError = window.api.on('recordings:liveError', (error: unknown) => {
        console.error('Live transcription error:', error)
      })

      const offFinished = window.api.on('recordings:liveFinished', (_finalText: unknown) => {
        liveSessionActive.current = false
      })

      liveCleanups.current = [offTranscript, offError, offFinished]
    } catch (err) {
      console.error('Failed to start live transcription:', err)
      liveSessionActive.current = false
    }
  }, [])

  const handleRecordingStop = useCallback(async () => {
    if (!liveSessionActive.current) return

    try {
      await window.api.invoke('recordings:stopLiveTranscribe' as never)
    } catch (err) {
      console.error('Failed to stop live transcription:', err)
    }

    // Clean up event listeners
    for (const cleanup of liveCleanups.current) cleanup()
    liveCleanups.current = []
    liveSessionActive.current = false
  }, [])

  async function handleRecordingComplete(blob: Blob, title: string) {
    // Capture live transcript before clearing
    const capturedLiveTranscript = liveTranscript

    const recording = await api.recordings.create({ projectId, title })
    const arrayBuffer = await blob.arrayBuffer()
    await api.recordings.saveAudio(recording.id, arrayBuffer)

    // If we had live transcription, save it as the transcript
    const updateData: Record<string, unknown> = { status: 'recorded' }
    if (capturedLiveTranscript) {
      updateData.transcript = capturedLiveTranscript
      updateData.transcriptionLanguage = 'pt'
      updateData.transcribedAt = new Date().toISOString()
      updateData.status = 'done'
    }

    const updated = await api.recordings.update(recording.id, updateData as {
      status?: string
      transcript?: string
      transcriptionLanguage?: string
      transcribedAt?: string
    })

    if (updated) {
      setRecordings((prev) => [updated, ...prev])
      setSelected(updated)
    }

    setLiveTranscript('')
  }

  async function handleTranscribe(id: string) {
    setIsTranscribing(true)
    try {
      const updated = await api.recordings.transcribe(id)
      if (updated) {
        setRecordings((prev) =>
          prev.map((r) => (r.id === id ? updated : r))
        )
        setSelected(updated)
      }
    } catch (err) {
      console.error('Transcription failed:', err)
      const refreshed = await api.recordings.get(id)
      if (refreshed) {
        setRecordings((prev) =>
          prev.map((r) => (r.id === id ? refreshed : r))
        )
        setSelected(refreshed)
      }
    }
    setIsTranscribing(false)
  }

  function handleDelete(id: string) {
    api.recordings.delete(id).then((ok) => {
      if (ok) {
        setRecordings((prev) => prev.filter((r) => r.id !== id))
        if (selected?.id === id) {
          setSelected(recordings.find((r) => r.id !== id) ?? null)
        }
      }
    })
  }

  return (
    <div className="flex flex-col h-full">
      <RecordingBar
        onRecordingComplete={handleRecordingComplete}
        onRecordingStart={handleRecordingStart}
        onRecordingStop={handleRecordingStop}
        liveTranscript={liveTranscript}
        liveEnabled={liveEnabled}
        onLiveToggle={setLiveEnabled}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 border-r border-neutral-800 flex flex-col shrink-0">
          <RecordingsList
            recordings={recordings}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onDelete={handleDelete}
          />
        </div>
        <div className="flex-1">
          <RecordingDetail
            recording={selected}
            onTranscribe={handleTranscribe}
            isTranscribing={isTranscribing}
            projectId={projectId}
          />
        </div>
      </div>
    </div>
  )
}
