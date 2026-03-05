import type { AppConfig } from '@shared/models'
import { Section, Select, StringList } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabBrowser({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Browser Automation">
        <StringList
          label="Allowed domains"
          hint="Restrict browser MCP tools to these domains. Leave empty to allow all."
          values={config.browserAllowedDomains}
          onChange={(v) => onChange({ browserAllowedDomains: v })}
          placeholder="example.com"
        />
      </Section>

      <Section title="Network">
        <Select
          label="Response body capture limit"
          hint="Maximum size of captured network response bodies"
          value={String(config.networkBodyLimit)}
          onChange={(v) => onChange({ networkBodyLimit: Number(v) })}
          options={[
            { value: '2048', label: '2 KB' },
            { value: '10240', label: '10 KB' },
            { value: '51200', label: '50 KB (default)' },
            { value: '102400', label: '100 KB' },
          ]}
        />
      </Section>
    </div>
  )
}
