/**
 * SonioxService — Async (batch) + Real-time (WebSocket) transcription via Soniox API.
 *
 * Async: stt-async-v4 (~$0.10/hour) — for post-recording transcription.
 * Real-time: stt-rt-v4 (~$0.12/hour) — for live transcription during recording.
 *
 * WebM from MediaRecorder lacks proper duration metadata, so we convert to OGG
 * via ffmpeg before uploading for async transcription.
 *
 * @see https://soniox.com/docs/stt/async/async-transcription
 * @see https://soniox.com/docs/stt/rt/real-time-transcription
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import WebSocket from 'ws'

// ─── Constants ───────────────────────────────────────────────────────────────

const SONIOX_API_BASE = 'https://api.soniox.com'
const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
const SONIOX_MODEL_ASYNC = 'stt-async-v4'
const SONIOX_MODEL_RT = 'stt-rt-v4'
const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 900 // 30 min max wait (900 * 2s)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SonioxTranscriptionResult {
  text: string
  durationMs: number
  language: string
}

interface SonioxFileResponse {
  id: string
  filename: string
  size: number
  created_at: string
}

interface SonioxTranscriptionStatus {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  audio_duration_ms: number | null
  error_type?: string | null
  error_message?: string | null
}

interface SonioxTranscriptResponse {
  id: string
  text: string
  tokens: Array<{
    text: string
    start_ms: number
    end_ms: number
    confidence: number
    language?: string
    speaker?: number
  }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Soniox API.
 */
async function sonioxFetch(
  apiKey: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${SONIOX_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  })

  if (!res.ok) {
    let errorDetail: string
    try {
      const body = await res.json()
      errorDetail = body.message || body.error_message || JSON.stringify(body)
    } catch {
      errorDetail = await res.text()
    }

    if (res.status === 401) {
      throw new Error('Soniox API key invalida. Verifique a chave em Settings > API Keys.')
    }
    throw new Error(`Soniox API error (${res.status}): ${errorDetail}`)
  }

  return res
}

/**
 * Convert WebM to OGG using ffmpeg.
 * MediaRecorder's WebM output often lacks proper duration metadata,
 * causing Soniox to reject the file. OGG/Opus works reliably.
 * Returns the path to the converted file (temp directory).
 */
function convertWebmToOgg(audioPath: string): string {
  const tempDir = os.tmpdir()
  const outputPath = path.join(
    tempDir,
    `soniox-${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`
  )

  try {
    execFileSync('ffmpeg', [
      '-i', audioPath,
      '-c:a', 'libopus',   // Opus codec (same as source, lossless transcode)
      '-b:a', '64k',       // 64kbps — good quality for speech, cost-effective
      '-y',                 // Overwrite output
      outputPath,
    ], {
      timeout: 120_000,     // 2 minute timeout
      stdio: 'pipe',        // Suppress ffmpeg output
    })
  } catch (err) {
    // Clean up partial output
    try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
    throw new Error(
      `Falha ao converter audio com ffmpeg: ${err instanceof Error ? err.message : 'Unknown error'}`
    )
  }

  return outputPath
}

// ─── Async (Batch) Transcription ─────────────────────────────────────────────

/**
 * Upload an audio file to Soniox Files API.
 */
async function uploadFile(apiKey: string, audioPath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(audioPath)
  const filename = path.basename(audioPath)
  const mimeType = audioPath.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm'
  const blob = new Blob([fileBuffer], { type: mimeType })

  const formData = new FormData()
  formData.append('file', blob, filename)

  const res = await sonioxFetch(apiKey, '/v1/files', {
    method: 'POST',
    body: formData,
  })

  const data = (await res.json()) as SonioxFileResponse
  return data.id
}

/**
 * Create a transcription job for a given file.
 */
async function createTranscription(
  apiKey: string,
  fileId: string
): Promise<string> {
  const res = await sonioxFetch(apiKey, '/v1/transcriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SONIOX_MODEL_ASYNC,
      file_id: fileId,
      language_hints: ['pt'],
      language_hints_strict: true,
      enable_language_identification: true,
    }),
  })

  const data = (await res.json()) as SonioxTranscriptionStatus
  return data.id
}

/**
 * Poll the transcription status until completed or error.
 */
async function waitForCompletion(
  apiKey: string,
  transcriptionId: string,
  onProgress?: (status: string) => void
): Promise<SonioxTranscriptionStatus> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await sonioxFetch(
      apiKey,
      `/v1/transcriptions/${transcriptionId}`
    )
    const data = (await res.json()) as SonioxTranscriptionStatus

    if (data.status === 'completed') return data

    if (data.status === 'error') {
      throw new Error(
        `Soniox transcription failed: ${data.error_message || data.error_type || 'Unknown error'}`
      )
    }

    onProgress?.(data.status)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error('Soniox transcription timed out after 30 minutes')
}

/**
 * Get the completed transcript.
 */
async function getTranscript(
  apiKey: string,
  transcriptionId: string
): Promise<SonioxTranscriptResponse> {
  const res = await sonioxFetch(
    apiKey,
    `/v1/transcriptions/${transcriptionId}/transcript`
  )
  return (await res.json()) as SonioxTranscriptResponse
}

/**
 * Cleanup remote resources (transcription + file). Best-effort.
 */
async function cleanup(
  apiKey: string,
  transcriptionId: string,
  fileId: string
): Promise<void> {
  try { await sonioxFetch(apiKey, `/v1/transcriptions/${transcriptionId}`, { method: 'DELETE' }) } catch { /* best-effort */ }
  try { await sonioxFetch(apiKey, `/v1/files/${fileId}`, { method: 'DELETE' }) } catch { /* best-effort */ }
}

/**
 * Transcribe an audio file using Soniox async API.
 * Converts WebM to OGG via ffmpeg to avoid format issues.
 */
export async function transcribeWithSoniox(
  apiKey: string,
  audioPath: string,
  onProgress?: (status: string) => void
): Promise<SonioxTranscriptionResult> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Soniox API key nao configurada. Va em Settings > API Keys para adicionar.')
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Arquivo de audio nao encontrado: ${audioPath}`)
  }

  // Convert WebM to OGG for reliable processing
  onProgress?.('converting')
  let uploadPath = audioPath
  let tempFile: string | null = null

  if (audioPath.endsWith('.webm')) {
    tempFile = convertWebmToOgg(audioPath)
    uploadPath = tempFile
  }

  try {
    // 1. Upload file
    onProgress?.('uploading')
    const fileId = await uploadFile(apiKey, uploadPath)

    let transcriptionId: string | null = null
    try {
      // 2. Create transcription job
      onProgress?.('queued')
      transcriptionId = await createTranscription(apiKey, fileId)

      // 3. Poll until complete
      const status = await waitForCompletion(apiKey, transcriptionId, onProgress)

      // 4. Get transcript
      const transcript = await getTranscript(apiKey, transcriptionId)

      // Detect the primary language from tokens
      const languageCounts: Record<string, number> = {}
      for (const token of transcript.tokens) {
        if (token.language) {
          languageCounts[token.language] = (languageCounts[token.language] || 0) + 1
        }
      }
      const primaryLanguage =
        Object.entries(languageCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'pt'

      return {
        text: transcript.text,
        durationMs: status.audio_duration_ms ?? 0,
        language: primaryLanguage,
      }
    } finally {
      // 5. Cleanup remote resources
      if (transcriptionId) {
        cleanup(apiKey, transcriptionId, fileId).catch(() => {})
      } else {
        sonioxFetch(apiKey, `/v1/files/${fileId}`, { method: 'DELETE' }).catch(() => {})
      }
    }
  } finally {
    // Clean up temp converted file
    if (tempFile) {
      try { fs.unlinkSync(tempFile) } catch { /* ignore */ }
    }
  }
}

// ─── Real-time (WebSocket) Transcription ─────────────────────────────────────

export interface SonioxRealtimeSession {
  /** Send raw PCM audio data (Float32 LE, 16kHz mono). */
  sendAudio: (pcmData: ArrayBuffer) => void
  /** Signal end of audio and close the session. Returns the final transcript. */
  finish: () => void
  /** Close the session immediately without waiting for final results. */
  abort: () => void
}

/**
 * Start a real-time transcription session via Soniox WebSocket.
 *
 * Audio format: pcm_f32le, 16kHz, mono — matches what AudioContext gives us.
 *
 * @param apiKey Soniox API key
 * @param onToken Called with accumulated transcript text on each server response
 * @param onError Called when an error occurs
 * @param onFinished Called when the session ends, with the final full transcript
 */
export function startRealtimeTranscription(
  apiKey: string,
  onToken: (text: string, isFinal: boolean) => void,
  onError: (error: string) => void,
  onFinished: (finalText: string) => void
): SonioxRealtimeSession {
  if (!apiKey || apiKey.trim() === '') {
    onError('Soniox API key nao configurada. Va em Settings > API Keys para adicionar.')
    return { sendAudio: () => {}, finish: () => {}, abort: () => {} }
  }

  const ws = new WebSocket(SONIOX_WS_URL)
  let finalText = ''
  let nonFinalText = ''

  ws.on('open', () => {
    // Send configuration message
    const config = JSON.stringify({
      api_key: apiKey,
      model: SONIOX_MODEL_RT,
      audio_format: 'pcm_f32le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ['pt'],
      language_hints_strict: true,
      enable_endpoint_detection: true,
    })
    ws.send(config)
  })

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const res = JSON.parse(data.toString())

      if (res.error_code) {
        onError(`Soniox RT error (${res.error_code}): ${res.error_message}`)
        return
      }

      // Process tokens
      nonFinalText = ''
      for (const token of res.tokens || []) {
        if (token.text) {
          if (token.is_final) {
            finalText += token.text
          } else {
            nonFinalText += token.text
          }
        }
      }

      // Send combined text (final + non-final) to UI
      const fullText = finalText + nonFinalText
      const hasNonFinal = nonFinalText.length > 0
      onToken(fullText, !hasNonFinal)

      if (res.finished) {
        onFinished(finalText)
      }
    } catch {
      // Ignore non-JSON messages
    }
  })

  ws.on('error', (err: Error) => {
    onError(`WebSocket connection error: ${err.message}`)
  })

  ws.on('close', () => {
    // Ensure we send final text even on unexpected close
    if (finalText) {
      onFinished(finalText)
    }
  })

  return {
    sendAudio(pcmData: ArrayBuffer) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from(pcmData))
      }
    },
    finish() {
      if (ws.readyState === WebSocket.OPEN) {
        // Empty string signals end-of-audio
        ws.send('')
      }
    },
    abort() {
      ws.close()
    },
  }
}
