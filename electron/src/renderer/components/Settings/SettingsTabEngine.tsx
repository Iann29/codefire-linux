import type { AppConfig } from '@shared/models'
import { Section, TextInput, Select, Toggle, NumberInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabEngine({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="API Key">
        <TextInput
          label="OpenRouter API Key"
          hint="Used for embeddings, chat, and image generation. Get one at openrouter.ai"
          placeholder="sk-or-..."
          value={config.openRouterKey}
          onChange={(v) => onChange({ openRouterKey: v })}
          secret
        />
      </Section>

      <Section title="Models">
        <Select
          label="Embedding model"
          value={config.embeddingModel}
          onChange={(v) => onChange({ embeddingModel: v })}
          options={[
            { value: 'openai/text-embedding-3-small', label: 'text-embedding-3-small' },
            { value: 'openai/text-embedding-3-large', label: 'text-embedding-3-large' },
          ]}
        />
        <Select
          label="Chat model"
          hint="Model used for summaries and briefings"
          value={config.chatModel}
          onChange={(v) => onChange({ chatModel: v })}
          options={[
            { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
            { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
            { value: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus' },
            { value: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next' },
            { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
            { value: 'minimax/minimax-m2.5', label: 'MiniMax M2.5' },
            { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
          ]}
        />
      </Section>

      <Section title="Automation">
        <Toggle
          label="Semantic code search"
          hint="Enable vector-based code search across projects"
          value={config.contextSearchEnabled}
          onChange={(v) => onChange({ contextSearchEnabled: v })}
        />
        <Toggle
          label="Auto-snapshot sessions"
          value={config.autoSnapshotSessions}
          onChange={(v) => onChange({ autoSnapshotSessions: v })}
        />
        <Toggle
          label="Auto-update codebase tree"
          value={config.autoUpdateCodebaseTree}
          onChange={(v) => onChange({ autoUpdateCodebaseTree: v })}
        />
        <Toggle
          label="Auto-start MCP server"
          hint="Launch the MCP server when the app starts"
          value={config.mcpServerAutoStart}
          onChange={(v) => onChange({ mcpServerAutoStart: v })}
        />
        <Toggle
          label="Instruction injection"
          hint="Inject .claude/instructions.md into CLI sessions"
          value={config.instructionInjection}
          onChange={(v) => onChange({ instructionInjection: v })}
        />
        <NumberInput
          label="Snapshot debounce (seconds)"
          value={config.snapshotDebounce}
          onChange={(v) => onChange({ snapshotDebounce: v })}
          min={5}
          max={120}
          step={5}
        />
      </Section>
    </div>
  )
}
