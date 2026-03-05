import type { AppConfig } from '@shared/models'
import { Section, NumberInput, StringList } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabBriefing({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Auto-Refresh">
        <NumberInput
          label="Staleness threshold (hours)"
          hint="Regenerate the briefing after this many hours"
          value={config.briefingStalenessHours}
          onChange={(v) => onChange({ briefingStalenessHours: v })}
          min={1}
          max={24}
          step={1}
        />
      </Section>

      <Section title="Sources">
        <StringList
          label="RSS feeds"
          hint="Feed URLs to include in the daily briefing"
          values={config.briefingRSSFeeds}
          onChange={(v) => onChange({ briefingRSSFeeds: v })}
          placeholder="https://example.com/feed.xml"
        />
        <StringList
          label="Subreddits"
          hint="Reddit subreddit names (without r/)"
          values={config.briefingSubreddits}
          onChange={(v) => onChange({ briefingSubreddits: v })}
          placeholder="MachineLearning"
        />
      </Section>
    </div>
  )
}
