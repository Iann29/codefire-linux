import { useState, useRef, useEffect } from 'react'
import { Flame, Zap, BookOpen, Cpu, ChevronDown, Plus, Trash2, Terminal } from 'lucide-react'
import type { ChatConversation, ChatEffortLevel, Session } from '@shared/models'

// ─── Types ───────────────────────────────────────────────────────────────────

type ModelCapability = 'tools' | 'vision' | 'streaming'

interface ChatModelOption {
  value: string
  label: string
  provider?: string
  capabilities?: ModelCapability[]
}

// ─── Chat Model Options ──────────────────────────────────────────────────────

export const CHAT_MODELS: ChatModelOption[] = [
  // OpenRouter models (available to all)
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash', capabilities: ['vision', 'streaming'] },
  { value: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus', capabilities: ['tools', 'streaming'] },
  { value: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next', capabilities: ['tools', 'streaming'] },
  { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', capabilities: ['tools', 'streaming'] },
  { value: 'minimax/minimax-m2.5', label: 'MiniMax M2.5', capabilities: ['streaming'] },
  { value: 'z-ai/glm-5', label: 'GLM-5', capabilities: ['tools', 'streaming'] },
  { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', capabilities: ['tools', 'streaming'] },
  { value: 'openai/gpt-5.4', label: 'GPT-5.4', capabilities: ['tools', 'vision', 'streaming'] },
  // Subscription-native models
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'claude-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'claude-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'claude-subscription', capabilities: ['vision', 'streaming'] },
  { value: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'o3', label: 'o3', provider: 'openai-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'o4-mini', label: 'o4 Mini', provider: 'openai-subscription', capabilities: ['streaming'] },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini-subscription', capabilities: ['vision', 'streaming'] },
]

const CLAUDE_EFFORT_OPTIONS: Array<{ value: ChatEffortLevel; label: string; shortLabel: string }> = [
  { value: 'default', label: 'Default', shortLabel: 'Auto' },
  { value: 'low', label: 'Low', shortLabel: 'L' },
  { value: 'medium', label: 'Medium', shortLabel: 'M' },
  { value: 'high', label: 'High', shortLabel: 'H' },
]

const CLAUDE_EFFORT_SUPPORTED_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
])

// ─── Model Aliases ────────────────────────────────────────────────────────────

interface ModelAlias {
  model: string
  provider?: string
  description: string
}

const MODEL_ALIASES: Record<string, ModelAlias> = {
  best: { model: 'claude-opus-4-6', provider: 'claude-subscription', description: 'Claude Opus 4.6' },
  fast: { model: 'claude-haiku-4-5-20251001', provider: 'claude-subscription', description: 'Claude Haiku 4.5' },
  cheap: { model: 'google/gemini-3-flash-preview', description: 'Gemini 3 Flash' },
  smart: { model: 'google/gemini-3.1-pro-preview', description: 'Gemini 3.1 Pro' },
  code: { model: 'qwen/qwen3-coder-next', description: 'Qwen3 Coder Next' },
}

/** Resolve a model alias to the real model value, or return the original */
export function resolveModelAlias(modelValue: string): string {
  const alias = MODEL_ALIASES[modelValue]
  return alias ? alias.model : modelValue
}

/** Check if a model supports vision (images) */
export function modelHasVision(modelValue: string): boolean {
  const resolved = resolveModelAlias(modelValue)
  const found = CHAT_MODELS.find(m => m.value === resolved)
  return found?.capabilities?.includes('vision') ?? false
}

export function modelSupportsClaudeEffort(modelValue: string): boolean {
  return CLAUDE_EFFORT_SUPPORTED_MODELS.has(resolveModelAlias(modelValue))
}

/** Get capability badge chars for a model */
function getCapabilityBadges(capabilities?: ModelCapability[]): { char: string; title: string; key: ModelCapability }[] {
  if (!capabilities || capabilities.length === 0) return []
  const badges: { char: string; title: string; key: ModelCapability }[] = []
  if (capabilities.includes('tools')) badges.push({ char: 'T', title: 'Tools', key: 'tools' })
  if (capabilities.includes('vision')) badges.push({ char: 'V', title: 'Vision', key: 'vision' })
  if (capabilities.includes('streaming')) badges.push({ char: 'S', title: 'Streaming', key: 'streaming' })
  return badges
}

/** Build alias entries as ChatModelOption items, filtered by provider availability */
function getAliasOptions(provider: string): (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] {
  return Object.entries(MODEL_ALIASES)
    .filter(([, alias]) => {
      if (alias.provider && provider !== alias.provider) return false
      return true
    })
    .map(([name, alias]) => {
      const target = CHAT_MODELS.find((m) => m.value === alias.model)
      return {
        value: `__alias__${name}`,
        label: `${name}`,
        provider: alias.provider,
        capabilities: target?.capabilities,
        _aliasTarget: alias.model,
        _aliasDescription: alias.description,
      }
    })
}

/** Get models relevant to the current provider, grouped */
function getModelsForProvider(provider: string): { group: string; models: (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] }[] {
  const groups: { group: string; models: (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] }[] = []

  const aliases = getAliasOptions(provider)
  if (aliases.length > 0) {
    groups.push({ group: 'Quick Aliases', models: aliases })
  }

  if (provider.endsWith('-subscription')) {
    const native = CHAT_MODELS.filter((m) => m.provider === provider)
    const openrouter = CHAT_MODELS.filter((m) => !m.provider)
    if (native.length > 0) {
      const label = provider.replace('-subscription', '').replace(/^./, (c) => c.toUpperCase())
      groups.push({ group: `${label} (subscription)`, models: native })
    }
    groups.push({ group: 'OpenRouter', models: openrouter })
    return groups
  }
  groups.push({ group: '', models: CHAT_MODELS.filter((m) => !m.provider) })
  return groups
}

export function getModelShortName(modelValue: string): string {
  const found = CHAT_MODELS.find((m) => m.value === modelValue)
  if (found) return found.label
  const resolvedModel = resolveModelAlias(modelValue)
  if (resolvedModel !== modelValue) {
    const resolvedFound = CHAT_MODELS.find((m) => m.value === resolvedModel)
    if (resolvedFound) return resolvedFound.label
  }
  const parts = modelValue.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelValue.replace(/-\d{8,}$/, '')
}

// ─── ChatHeader Props ────────────────────────────────────────────────────────

export interface ChatHeaderProps {
  chatMode: 'context' | 'agent'
  onToggleMode: () => void
  chatModel: string
  onModelChange: (model: string) => void
  chatEffortLevel: ChatEffortLevel
  onEffortLevelChange: (level: ChatEffortLevel) => void
  aiProvider: string
  conversations: ChatConversation[]
  sessions: Session[]
  activeConversationId: number | null
  onSelectConversation: (id: number) => void
  onNewConversation: () => void
  onDeleteConversation: (id: number, e: React.MouseEvent) => void
}

// ─── ChatHeader Component ────────────────────────────────────────────────────

export default function ChatHeader({
  chatMode,
  onToggleMode,
  chatModel,
  onModelChange,
  chatEffortLevel,
  onEffortLevelChange,
  aiProvider,
  conversations,
  sessions,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: ChatHeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    if (showDropdown || showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown, showModelDropdown])

  const activeConversation = conversations.find(c => c.id === activeConversationId)
  const dropdownLabel = activeConversation?.title || 'Select thread...'
  const resolvedModel = resolveModelAlias(chatModel)
  const resolvedModelMeta = CHAT_MODELS.find((model) => model.value === resolvedModel)
  const showClaudeEffort =
    aiProvider === 'claude-subscription' &&
    resolvedModelMeta?.provider === 'claude-subscription' &&
    modelSupportsClaudeEffort(chatModel)

  return (
    <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <Flame size={14} className="text-codefire-orange shrink-0" />
          <span className="text-[11px] font-semibold text-neutral-300 shrink-0">Pinyino</span>
        </div>

        <button
          onClick={onToggleMode}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors shrink-0 ${
            chatMode === 'agent'
              ? 'bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30'
              : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-300'
          }`}
          title={chatMode === 'context' ? 'Context Mode -- low cost, RAG-enhanced' : 'Agent Mode -- full tool calling'}
        >
          {chatMode === 'agent' ? <Zap size={10} /> : <BookOpen size={10} />}
          {chatMode === 'agent' ? 'Agent' : 'Context'}
        </button>

        <div className="relative flex-1 min-w-0" ref={modelDropdownRef}>
          <button
            onClick={() => setShowModelDropdown((v) => !v)}
            className="flex items-center justify-between gap-1 w-full min-w-0 px-2 py-1 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-300 transition-colors"
            title={`Model: ${chatModel}`}
          >
            <span className="flex items-center gap-1 min-w-0 flex-1">
              <Cpu size={10} className="shrink-0" />
              <span className="truncate">{getModelShortName(chatModel)}</span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {aiProvider.endsWith('-subscription') && (
                <span className="text-[8px] text-green-500 font-bold" title="Using your subscription">SUB</span>
              )}
              <ChevronDown size={8} className="text-neutral-500" />
            </span>
          </button>

          {showModelDropdown && (
            <div
              className="absolute top-full right-0 mt-1 max-h-80 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 py-1"
              style={{ width: 'min(16rem, calc(100vw - 1.5rem))' }}
            >
              {getModelsForProvider(aiProvider).map(({ group, models }) => (
                <div key={group || 'default'}>
                  {group && (
                    <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider border-t border-neutral-800 first:border-t-0 mt-1 first:mt-0">
                      {group}
                    </div>
                  )}
                  {models.map((m) => {
                    const isAlias = m.value.startsWith('__alias__')
                    const aliasName = isAlias ? m.value.replace('__alias__', '') : null
                    const aliasTarget = isAlias ? m._aliasTarget : null
                    const aliasDescription = isAlias ? m._aliasDescription : null
                    const isActive = isAlias ? chatModel === aliasTarget : m.value === chatModel
                    const badges = getCapabilityBadges(m.capabilities)

                    return (
                      <button
                        key={m.value}
                        onClick={() => {
                          const modelToSet = isAlias && aliasTarget ? aliasTarget : m.value
                          onModelChange(modelToSet)
                          setShowModelDropdown(false)
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] transition-colors ${
                          isActive
                            ? 'bg-neutral-800 text-codefire-orange'
                            : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300'
                        }`}
                      >
                        {isAlias ? (
                          <span className="truncate flex-1 text-left">
                            <span className="font-semibold">{aliasName}</span>
                            <span className="text-neutral-500"> {'\u2192'} {aliasDescription}</span>
                          </span>
                        ) : (
                          <span className="truncate">{m.label}</span>
                        )}
                        {badges.length > 0 && (
                          <span className="flex items-center gap-0.5 shrink-0">
                            {badges.map((b) => (
                              <span
                                key={b.key}
                                title={b.title}
                                className="text-[8px] text-neutral-600 font-mono leading-none px-0.5 rounded bg-neutral-800"
                              >
                                {b.char}
                              </span>
                            ))}
                          </span>
                        )}
                        {isActive && (
                          <span className="ml-auto text-[9px] text-codefire-orange/60 shrink-0">active</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {showClaudeEffort && (
          <div
            className="flex items-center gap-0.5 rounded-full border border-neutral-700 bg-neutral-900/80 p-0.5 shrink-0"
            title="Claude effort"
          >
            {CLAUDE_EFFORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => onEffortLevelChange(option.value)}
                className={`px-1.5 py-1 rounded-full text-[9px] font-medium transition-colors ${
                  chatEffortLevel === option.value
                    ? 'bg-codefire-orange/20 text-codefire-orange'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
                }`}
                title={`Claude effort: ${option.label}`}
              >
                {option.shortLabel}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <div className="relative flex-1 min-w-0" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(v => !v)}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded bg-neutral-800/60 hover:bg-neutral-800 transition-colors text-left min-w-0"
          >
            <span className="text-[11px] text-neutral-300 truncate flex-1">{dropdownLabel}</span>
            <ChevronDown size={12} className="text-neutral-500 shrink-0" />
          </button>

          {showDropdown && (
            <div
              className="absolute top-full right-0 mt-1 max-h-80 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50"
              style={{ width: 'min(18rem, calc(100vw - 1.5rem))' }}
            >
              <button
                onClick={() => { onNewConversation(); setShowDropdown(false) }}
                className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-codefire-orange hover:bg-neutral-800 transition-colors border-b border-neutral-800"
              >
                <Plus size={12} />
                New Chat
              </button>

              {conversations.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Conversations
                  </div>
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => { onSelectConversation(conv.id); setShowDropdown(false) }}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] transition-colors group ${
                        conv.id === activeConversationId
                          ? 'bg-neutral-800 text-neutral-200'
                          : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300'
                      }`}
                    >
                      <span className="truncate flex-1 text-left">{conv.title}</span>
                      <span className="text-[9px] text-neutral-600 shrink-0">
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={(e) => onDeleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-600 hover:text-red-400 transition-all shrink-0"
                      >
                        <Trash2 size={10} />
                      </button>
                    </button>
                  ))}
                </div>
              )}

              {sessions.length > 0 && (
                <div className="py-1 border-t border-neutral-800">
                  <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Claude Sessions
                  </div>
                  {sessions.slice(0, 20).map((session) => (
                    <button
                      key={session.id}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300 transition-colors"
                    >
                      <Terminal size={10} className="shrink-0 text-neutral-600" />
                      <span className="truncate flex-1 text-left">
                        {session.summary || session.slug || session.id.slice(0, 8)}
                      </span>
                      <span className="text-[9px] text-neutral-600 shrink-0">
                        {session.startedAt ? new Date(session.startedAt).toLocaleDateString() : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onNewConversation}
          className="p-1.5 rounded text-neutral-500 hover:text-codefire-orange hover:bg-neutral-800 transition-colors shrink-0"
          title="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}
