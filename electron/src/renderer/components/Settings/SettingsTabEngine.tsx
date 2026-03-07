import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trash2, Database } from 'lucide-react'
import type { AppConfig, Project, IndexState } from '@shared/models'
import { api } from '../../lib/api'
import { Section, TextInput, Select, Toggle, NumberInput, Slider } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

function IndexStatusPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [indexStates, setIndexStates] = useState<Map<string, IndexState | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const projectList = await api.projects.list()
    const display = projectList.filter((p) => p.id !== '__global__')
    setProjects(display)

    const states = new Map<string, IndexState | null>()
    await Promise.all(
      display.map(async (p) => {
        const state = await api.search.getIndexState(p.id).catch(() => null)
        states.set(p.id, state)
      })
    )
    setIndexStates(states)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleReindex(projectId: string) {
    setActionInProgress(projectId)
    await api.search.reindex(projectId).catch(() => {})
    // Brief delay then refresh state
    setTimeout(async () => {
      const state = await api.search.getIndexState(projectId).catch(() => null)
      setIndexStates((prev) => new Map(prev).set(projectId, state))
      setActionInProgress(null)
    }, 1000)
  }

  async function handleClear(projectId: string) {
    setActionInProgress(projectId)
    await api.search.clearIndex(projectId).catch(() => {})
    const state = await api.search.getIndexState(projectId).catch(() => null)
    setIndexStates((prev) => new Map(prev).set(projectId, state))
    setActionInProgress(null)
  }

  if (loading) {
    return <p className="text-[10px] text-neutral-600">Loading index status...</p>
  }

  if (projects.length === 0) {
    return <p className="text-[10px] text-neutral-600">No projects to index.</p>
  }

  return (
    <div className="space-y-1.5">
      {projects.map((p) => {
        const state = indexStates.get(p.id)
        const status = state?.status ?? 'idle'
        const chunks = state?.totalChunks ?? 0
        const isActive = actionInProgress === p.id
        const name = p.name.split(/[/\\]/).pop() ?? p.name

        return (
          <div
            key={p.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700"
          >
            <Database size={12} className="text-neutral-500 shrink-0" />
            <span className="text-xs text-neutral-300 truncate flex-1" title={p.name}>
              {name}
            </span>
            <span className={`text-[10px] font-mono shrink-0 ${
              status === 'idle' ? 'text-neutral-600' :
              status === 'indexing' ? 'text-codefire-orange' :
              status === 'error' ? 'text-red-400' : 'text-green-400'
            }`}>
              {status === 'idle' ? 'Not indexed' :
               status === 'indexing' ? 'Indexing...' :
               status === 'error' ? 'Error' :
               `${chunks} chunks`}
            </span>
            <button
              type="button"
              onClick={() => handleReindex(p.id)}
              disabled={isActive}
              className="text-neutral-500 hover:text-codefire-orange transition-colors disabled:opacity-30"
              title="Rebuild index"
            >
              <RefreshCw size={12} className={isActive ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => handleClear(p.id)}
              disabled={isActive}
              className="text-neutral-500 hover:text-red-400 transition-colors disabled:opacity-30"
              title="Clear index"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function SettingsTabEngine({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="AI Provider">
        <Select
          label="Provider"
          hint="Choose how the agent connects to AI models."
          value={config.aiProvider || 'openrouter'}
          onChange={(v) => onChange({ aiProvider: v as 'openrouter' | 'custom' })}
          options={[
            { value: 'openrouter', label: 'OpenRouter (API key)' },
            { value: 'custom', label: 'Custom Endpoint (OpenAI-compatible)' },
          ]}
        />

        {(config.aiProvider || 'openrouter') === 'openrouter' && (
          <TextInput
            label="OpenRouter API Key"
            hint="Used for embeddings, chat, and image generation. Get one at openrouter.ai"
            placeholder="sk-or-..."
            value={config.openRouterKey}
            onChange={(v) => onChange({ openRouterKey: v })}
            secret
          />
        )}

        {config.aiProvider === 'custom' && (
          <>
            <TextInput
              label="Endpoint URL"
              hint="Base URL of an OpenAI-compatible API (e.g. http://localhost:8080/v1). Works with CLIProxyAPI, Ollama, LM Studio, LiteLLM, etc."
              placeholder="http://localhost:8080/v1"
              value={config.customEndpointUrl}
              onChange={(v) => onChange({ customEndpointUrl: v })}
            />
            <TextInput
              label="API Key (optional)"
              hint="Leave empty if your endpoint doesn't require authentication."
              placeholder="sk-..."
              value={config.customEndpointKey}
              onChange={(v) => onChange({ customEndpointKey: v })}
              secret
            />
          </>
        )}
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
            { value: 'z-ai/glm-5', label: 'GLM-5' },
            { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
            { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
          ]}
        />
        <Select
          label="Chat mode"
          hint="Context: low cost, RAG-enhanced Q&A. Agent: full tool calling, can take actions."
          value={config.chatMode || 'context'}
          onChange={(v) => onChange({ chatMode: v as 'context' | 'agent' })}
          options={[
            { value: 'context', label: 'Context (low cost)' },
            { value: 'agent', label: 'Agent (tool calling)' },
          ]}
        />
      </Section>

      <Section title="Agent Runtime (V2)">
        <Toggle
          label="Enable main-process runtime"
          hint="Uses the new agent runtime in Electron main process with direct browser IPC."
          value={config.agentRuntimeV2}
          onChange={(v) => onChange({ agentRuntimeV2: v })}
        />
        <NumberInput
          label="Max tool calls per run"
          hint="Hard cap for tool-calling loop in agent mode."
          value={config.agentMaxToolCalls}
          onChange={(v) => onChange({ agentMaxToolCalls: Number.isFinite(v) ? Math.max(1, Math.min(60, Math.round(v))) : 30 })}
          min={1}
          max={60}
          step={1}
        />
        <Slider
          label="Agent temperature"
          hint="Lower values are more deterministic. Higher values are more exploratory."
          value={config.agentTemperature}
          onChange={(v) => onChange({ agentTemperature: Math.max(0, Math.min(1, Number(v.toFixed(1)))) })}
          min={0}
          max={1}
          step={0.1}
        />
        <Toggle
          label="Plan enforcement"
          hint="Requires set_plan before browser actions and verification before next action."
          value={config.agentPlanEnforcement}
          onChange={(v) => onChange({ agentPlanEnforcement: v })}
        />
        <Toggle
          label="Context compaction (preview)"
          hint="Reserved for long-run summarization; currently no-op in runtime."
          value={config.agentContextCompaction}
          onChange={(v) => onChange({ agentContextCompaction: v })}
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

      <Section title="Index Status">
        <p className="text-[10px] text-neutral-600 mb-2">
          Semantic code index for each project. Rebuild to re-index all files, or clear to remove index data.
        </p>
        <IndexStatusPanel />
      </Section>
    </div>
  )
}
