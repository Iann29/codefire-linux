import { RotateCcw } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { Section, TextArea } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

const PROMPT_DEFS = [
  {
    key: 'promptAgentSystem' as const,
    title: 'Agent System Prompt',
    hint: 'System prompt sent to the AI agent when running in Agent Mode. Supports {projectName} placeholder.',
    placeholder: 'You are the Pinyino agent for "{projectName}"...',
    rows: 5,
  },
  {
    key: 'promptContextSystem' as const,
    title: 'Context Mode System Prompt',
    hint: 'System prompt for Context Mode chat. Supports {projectName} placeholder.',
    placeholder: 'You are a helpful assistant with deep context about the "{projectName}" project...',
    rows: 5,
  },
  {
    key: 'promptSummarization' as const,
    title: 'Session Summarization',
    hint: 'Prompt used to generate summaries of AI coding sessions.',
    placeholder: 'You are a coding assistant. Summarize this AI coding session in 2-3 concise sentences...',
    rows: 4,
  },
  {
    key: 'promptTaskExtraction' as const,
    title: 'Task Extraction',
    hint: 'Prompt used to extract follow-up tasks from sessions.',
    placeholder: 'Based on this AI coding session, extract follow-up tasks...',
    rows: 4,
  },
  {
    key: 'promptTaskDescription' as const,
    title: 'Task Description Generation',
    hint: 'Prompt used to generate task descriptions from titles.',
    placeholder: 'Given a task title and optional description, write a clear, actionable description...',
    rows: 4,
  },
]

export default function SettingsTabPrompts({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <p className="text-[11px] text-neutral-500">
        Customize system prompts used by Chat Mode and AI services. Leave empty to use defaults.
      </p>
      {PROMPT_DEFS.map((def) => (
        <Section key={def.key} title={def.title}>
          <div className="relative">
            <TextArea
              label=""
              hint={def.hint}
              placeholder={def.placeholder}
              value={config[def.key] || ''}
              onChange={(v) => onChange({ [def.key]: v })}
              rows={def.rows}
            />
            {config[def.key] && (
              <button
                onClick={() => onChange({ [def.key]: '' })}
                className="absolute top-0 right-0 p-1 text-neutral-600 hover:text-neutral-300 transition-colors"
                title="Reset to default"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
          {config[def.key] ? (
            <span className="text-[9px] text-codefire-orange">customized</span>
          ) : (
            <span className="text-[9px] text-neutral-600">using default</span>
          )}
        </Section>
      ))}
    </div>
  )
}
