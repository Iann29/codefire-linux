import { useState, useRef, useCallback } from 'react'

interface UseRecorderReturn {
  isRecording: boolean
  duration: number
  startRecording: (enableLivePcm?: boolean) => Promise<void>
  stopRecording: () => Promise<Blob | null>
}

/**
 * Hook for audio recording using MediaRecorder.
 *
 * When `enableLivePcm` is true, also captures raw PCM (Float32, 16kHz, mono)
 * via ScriptProcessorNode and sends chunks through IPC for real-time transcription.
 */
export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const startRecording = useCallback(async (enableLivePcm = false) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    })

    chunksRef.current = []
    mediaRecorderRef.current = mediaRecorder

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    mediaRecorder.start(1000)
    startTimeRef.current = Date.now()
    setIsRecording(true)
    setDuration(0)

    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 500)

    // Set up raw PCM capture for real-time transcription
    if (enableLivePcm) {
      // 16kHz for speech — matches Soniox expected sample rate and saves bandwidth
      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx

      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source

      // bufferSize=4096 at 16kHz = ~256ms chunks — good balance for real-time
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        // Copy the Float32Array (it's reused by the browser)
        const pcmCopy = new Float32Array(inputData)
        window.api.send('recordings:sendAudioChunk', pcmCopy.buffer)
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)
    }
  }, [])

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    // Clean up PCM capture
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        resolve(null)
        return
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        mediaRecorder.stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        setIsRecording(false)
        resolve(blob)
      }

      mediaRecorder.stop()
    })
  }, [])

  return { isRecording, duration, startRecording, stopRecording }
}
