import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readConfig } from '../ConfigStore'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let client: SupabaseClient | null = null

const TOKEN_FILE = 'supabase-session.json'

function getTokenPath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILE)
}

function loadPersistedSession(): { access_token: string; refresh_token: string } | null {
  try {
    const data = fs.readFileSync(getTokenPath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

function persistSession(session: { access_token: string; refresh_token: string } | null): void {
  if (session) {
    fs.writeFileSync(getTokenPath(), JSON.stringify(session), 'utf-8')
  } else {
    try { fs.unlinkSync(getTokenPath()) } catch { /* ignore */ }
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client

  const config = readConfig()
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null

  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
  })

  const saved = loadPersistedSession()
  if (saved) {
    client.auth.setSession(saved)
  }

  client.auth.onAuthStateChange((_event, session) => {
    if (session) {
      persistSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    } else {
      persistSession(null)
    }
  })

  return client
}

export function resetSupabaseClient(): void {
  client = null
  persistSession(null)
}
