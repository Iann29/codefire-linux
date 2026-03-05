import { useState, useEffect } from 'react'
import { Trash2, Plus, RefreshCw } from 'lucide-react'
import type { AppConfig, GmailAccount, WhitelistRule } from '@shared/models'
import { api } from '../../lib/api'
import { Section, TextInput, Toggle, NumberInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabGmail({ config, onChange }: Props) {
  const [accounts, setAccounts] = useState<GmailAccount[]>([])
  const [rules, setRules] = useState<WhitelistRule[]>([])
  const [newPattern, setNewPattern] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.gmail.listAccounts().then(setAccounts).catch(() => {})
    api.gmail.listRules().then(setRules).catch(() => {})
  }, [])

  async function handleConnect() {
    setLoading(true)
    try {
      const account = await api.gmail.authenticate()
      setAccounts((prev) => [...prev, account])
    } catch {
      // auth cancelled or failed
    }
    setLoading(false)
  }

  async function handleRemoveAccount(id: string) {
    await api.gmail.removeAccount(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleAddRule() {
    const pattern = newPattern.trim()
    if (!pattern) return
    const rule = await api.gmail.addRule({ pattern })
    setRules((prev) => [...prev, rule])
    setNewPattern('')
  }

  async function handleRemoveRule(id: string) {
    await api.gmail.removeRule(id)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-6">
      <Section title="Google OAuth Credentials">
        <TextInput
          label="Google Client ID"
          hint="Create OAuth credentials in the Google Cloud Console"
          placeholder="123456789.apps.googleusercontent.com"
          value={config.googleClientId}
          onChange={(v) => onChange({ googleClientId: v })}
          secret
        />
        <TextInput
          label="Google Client Secret"
          placeholder="GOCSPX-..."
          value={config.googleClientSecret}
          onChange={(v) => onChange({ googleClientSecret: v })}
          secret
        />
        <p className="text-[10px] text-neutral-600">
          Save credentials first, then connect accounts below.
        </p>
      </Section>

      <Section title="Sync">
        <Toggle
          label="Enable Gmail sync"
          value={config.gmailSyncEnabled}
          onChange={(v) => onChange({ gmailSyncEnabled: v })}
        />
        <NumberInput
          label="Sync interval (seconds)"
          hint="How often to check for new emails"
          value={config.gmailSyncInterval}
          onChange={(v) => onChange({ gmailSyncInterval: v })}
          min={60}
          max={1800}
          step={60}
        />
      </Section>

      <Section title="Connected Accounts">
        {accounts.length === 0 ? (
          <p className="text-[10px] text-neutral-600">No accounts connected.</p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700"
              >
                <span className="text-xs text-neutral-300 truncate">{a.email}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAccount(a.id)}
                  className="text-neutral-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={handleConnect}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs
                     bg-neutral-800 border border-neutral-700 text-neutral-300
                     hover:border-neutral-600 hover:text-neutral-200 transition-colors
                     disabled:opacity-50"
        >
          {loading ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
          Connect Account
        </button>
      </Section>

      <Section title="Whitelist Rules">
        <p className="text-[10px] text-neutral-600">
          Only emails matching these patterns will be imported. Leave empty to import all.
        </p>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddRule())}
            placeholder="*@example.com"
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                       text-xs text-neutral-200 placeholder:text-neutral-600
                       focus:outline-none focus:border-codefire-orange/50"
          />
          <button
            type="button"
            onClick={handleAddRule}
            className="px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700
                       text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
        {rules.length > 0 && (
          <div className="space-y-1">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between px-2.5 py-1 rounded bg-neutral-800 border border-neutral-700"
              >
                <span className="text-xs text-neutral-400 font-mono truncate">{r.pattern}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveRule(r.id)}
                  className="text-neutral-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
