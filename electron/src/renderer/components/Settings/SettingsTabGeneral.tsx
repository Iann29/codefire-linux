import type { AppConfig } from '@shared/models'
import { Section, Toggle, Select } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabGeneral({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Application">
        <Toggle
          label="Check for updates"
          hint="Automatically check for new versions on launch"
          value={config.checkForUpdates}
          onChange={(v) => onChange({ checkForUpdates: v })}
        />
        <Toggle
          label="Demo mode"
          hint="Replace names and titles with placeholder data for screenshots"
          value={config.demoMode}
          onChange={(v) => onChange({ demoMode: v })}
        />
      </Section>

      <Section title="Notifications">
        <Toggle
          label="New email notifications"
          value={config.notifyOnNewEmail}
          onChange={(v) => onChange({ notifyOnNewEmail: v })}
        />
        <Toggle
          label="CLI completion notifications"
          hint="Notify when Claude/Gemini finishes a task"
          value={config.notifyOnClaudeDone}
          onChange={(v) => onChange({ notifyOnClaudeDone: v })}
        />
      </Section>

      <Section title="CLI">
        <Select
          label="Preferred CLI"
          value={config.preferredCLI}
          onChange={(v) => onChange({ preferredCLI: v as AppConfig['preferredCLI'] })}
          options={[
            { value: 'claude', label: 'Claude Code' },
            { value: 'gemini', label: 'Gemini CLI' },
            { value: 'codex', label: 'Codex CLI' },
          ]}
        />
      </Section>

      <Section title="About">
        <div className="text-xs text-neutral-500">Version 1.0.4 (Electron)</div>
      </Section>
    </div>
  )
}
