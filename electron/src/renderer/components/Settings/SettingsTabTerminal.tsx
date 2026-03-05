import type { AppConfig } from '@shared/models'
import { Section, NumberInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabTerminal({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Terminal">
        <NumberInput
          label="Font size"
          hint="Terminal font size in points"
          value={config.terminalFontSize}
          onChange={(v) => onChange({ terminalFontSize: v })}
          min={10}
          max={24}
          step={1}
        />
        <NumberInput
          label="Scrollback lines"
          hint="Number of lines kept in the scrollback buffer"
          value={config.scrollbackLines}
          onChange={(v) => onChange({ scrollbackLines: v })}
          min={1000}
          max={100000}
          step={1000}
        />
      </Section>
    </div>
  )
}
