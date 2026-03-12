import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react'
import { useRecorder } from '@renderer/hooks/useRecorder'

interface RecordingContextType {
  isRecording: boolean
  duration: number
  startRecording(enableLivePcm?: boolean): Promise<void>
  stopRecording(): Promise<Blob | null>
  registerStopCallback(cb: () => void | Promise<void>): () => void
}

const RecordingContext = createContext<RecordingContextType | null>(null)

export function RecordingProvider({ children }: { children: ReactNode }) {
  const {
    isRecording,
    duration,
    startRecording: recorderStart,
    stopRecording: recorderStop,
  } = useRecorder()
  const stopCallbacksRef = useRef<Set<() => void | Promise<void>>>(new Set())

  const startRecording = useCallback(
    async (enableLivePcm = false) => {
      await recorderStart(enableLivePcm)
    },
    [recorderStart]
  )

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    // Call registered stop callbacks before stopping (e.g., live transcription cleanup)
    for (const cb of stopCallbacksRef.current) {
      try {
        await cb()
      } catch (err) {
        console.error('Recording stop callback error:', err)
      }
    }
    return recorderStop()
  }, [recorderStop])

  const registerStopCallback = useCallback((cb: () => void | Promise<void>) => {
    stopCallbacksRef.current.add(cb)
    return () => {
      stopCallbacksRef.current.delete(cb)
    }
  }, [])

  return (
    <RecordingContext.Provider
      value={{ isRecording, duration, startRecording, stopRecording, registerStopCallback }}
    >
      {children}
    </RecordingContext.Provider>
  )
}

export function useGlobalRecording(): RecordingContextType {
  const ctx = useContext(RecordingContext)
  if (!ctx) {
    throw new Error('useGlobalRecording must be used within a RecordingProvider')
  }
  return ctx
}
