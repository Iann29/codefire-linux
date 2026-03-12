import { ipcMain, app, BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { RecordingDAO } from '../database/dao/RecordingDAO'
import {
  transcribeWithSoniox,
  startRealtimeTranscription,
  type SonioxRealtimeSession,
} from '../services/SonioxService'
import { readConfig } from '../services/ConfigStore'
import * as path from 'node:path'
import * as fs from 'node:fs'

export function registerRecordingHandlers(db: Database.Database) {
  const recordingDAO = new RecordingDAO(db)

  // Track active real-time sessions per window
  const realtimeSessions = new Map<number, SonioxRealtimeSession>()

  ipcMain.handle('recordings:list', (_e, projectId: string) =>
    recordingDAO.list(projectId)
  )

  ipcMain.handle('recordings:get', (_e, id: string) =>
    recordingDAO.getById(id)
  )

  ipcMain.handle(
    'recordings:create',
    (_e, data: { projectId: string; title: string }) => {
      const recordingsDir = path.join(app.getPath('userData'), 'recordings')
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true })
      }
      const audioPath = path.join(
        recordingsDir,
        `${Date.now()}-${data.title.replace(/[^a-zA-Z0-9]/g, '_')}.webm`
      )
      return recordingDAO.create({
        projectId: data.projectId,
        title: data.title,
        audioPath,
      })
    }
  )

  ipcMain.handle(
    'recordings:update',
    (
      _e,
      id: string,
      data: {
        title?: string
        duration?: number
        transcript?: string
        transcriptionLanguage?: string
        transcribedAt?: string
        status?: string
        errorMessage?: string
      }
    ) => recordingDAO.update(id, data)
  )

  ipcMain.handle('recordings:delete', (_e, id: string) => {
    const recording = recordingDAO.getById(id)
    if (recording) {
      try {
        if (fs.existsSync(recording.audioPath)) {
          fs.unlinkSync(recording.audioPath)
        }
      } catch {
        // File may already be gone
      }
    }
    return recordingDAO.delete(id)
  })

  ipcMain.handle(
    'recordings:saveAudio',
    (_e, id: string, audioData: ArrayBuffer) => {
      const recording = recordingDAO.getById(id)
      if (!recording) return false
      fs.writeFileSync(recording.audioPath, Buffer.from(audioData))
      return true
    }
  )

  ipcMain.handle('recordings:transcribe', async (_e, id: string) => {
    const recording = recordingDAO.getById(id)
    if (!recording) throw new Error('Recording not found')
    if (!fs.existsSync(recording.audioPath)) {
      throw new Error('Audio file not found')
    }

    const config = readConfig()
    const apiKey = config.sonioxApiKey
    if (!apiKey) {
      throw new Error(
        'Soniox API key nao configurada. Va em Settings > API Keys para adicionar.'
      )
    }

    recordingDAO.update(id, { status: 'transcribing', errorMessage: '' })

    try {
      const result = await transcribeWithSoniox(apiKey, recording.audioPath)

      return recordingDAO.update(id, {
        transcript: result.text,
        duration: result.durationMs / 1000,
        transcriptionLanguage: result.language,
        transcribedAt: new Date().toISOString(),
        status: 'done',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      recordingDAO.update(id, { status: 'error', errorMessage: message })
      throw err
    }
  })

  // ─── Real-time transcription IPC ─────────────────────────────────────────

  ipcMain.handle('recordings:startLiveTranscribe', (event) => {
    const config = readConfig()
    const apiKey = config.sonioxApiKey
    if (!apiKey) {
      throw new Error(
        'Soniox API key nao configurada. Va em Settings > API Keys para adicionar.'
      )
    }

    const webContents = event.sender
    const windowId = webContents.id

    // Abort any existing session for this window
    const existing = realtimeSessions.get(windowId)
    if (existing) existing.abort()

    const session = startRealtimeTranscription(
      apiKey,
      (text, isFinal) => {
        try { webContents.send('recordings:liveTranscript', text, isFinal) } catch { /* window closed */ }
      },
      (error) => {
        try { webContents.send('recordings:liveError', error) } catch { /* window closed */ }
        realtimeSessions.delete(windowId)
      },
      (finalText) => {
        try { webContents.send('recordings:liveFinished', finalText) } catch { /* window closed */ }
        realtimeSessions.delete(windowId)
      }
    )

    realtimeSessions.set(windowId, session)
    return { ok: true }
  })

  ipcMain.on('recordings:sendAudioChunk', (event, pcmData: ArrayBuffer) => {
    const session = realtimeSessions.get(event.sender.id)
    if (session) session.sendAudio(pcmData)
  })

  ipcMain.handle('recordings:stopLiveTranscribe', (event) => {
    const session = realtimeSessions.get(event.sender.id)
    if (session) {
      session.finish()
    }
    return { ok: true }
  })
}
