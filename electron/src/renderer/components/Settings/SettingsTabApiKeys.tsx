import type { AppConfig } from '@shared/models'
import { Section, TextInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabApiKeys({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Soniox (Speech-to-Text)">
        <TextInput
          label="Soniox API Key"
          hint="Used for audio transcription (pt-BR). Get your key at console.soniox.com"
          placeholder="Enter your Soniox API key"
          value={config.sonioxApiKey}
          onChange={(v) => onChange({ sonioxApiKey: v })}
          secret
        />
        <div className="mt-2 space-y-1">
          <p className="text-[10px] text-neutral-600">
            Model: stt-async-v4 (batch) — ~$0.10/hour of audio
          </p>
          <p className="text-[10px] text-neutral-600">
            Supported formats: WebM, MP3, WAV, FLAC, OGG, AAC, M4A, MP4
          </p>
          <p className="text-[10px] text-neutral-600">
            Max duration: 5 hours per file — No file size limit issues for typical recordings
          </p>
        </div>
      </Section>

      <Section title="Other API Keys">
        <p className="text-[10px] text-neutral-600">
          OpenRouter, Google AI, and other provider keys are configured in the Engine tab.
        </p>
      </Section>
    </div>
  )
}
