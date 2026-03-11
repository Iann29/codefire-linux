import { useState, useRef, useEffect } from 'react'
import { Flame, Zap, BookOpen, Cpu, ChevronDown, Plus, Trash2, Terminal } from 'lucide-react'
import type { ChatConversation, ChatEffortLevel, ProviderModelGroup, Session } from '@shared/models'
import {
  modelSupportsClaudeEffortById,
  modelSupportsVisionById,
  normalizeProviderModelId,
} from '@shared/chatModelCapabilities'

// ─── Types ───────────────────────────────────────────────────────────────────

type ModelCapability = 'tools' | 'vision' | 'streaming'

interface ChatModelOption {
  value: string
  label: string
  provider?: string
  capabilities?: ModelCapability[]
}

// ─── Static Model Capabilities Map ───────────────────────────────────────────
// Capabilities are properties of the models themselves, not the provider.
// This map is used for badge display regardless of which provider serves them.

const MODEL_CAPABILITIES: Record<string, ModelCapability[]> = {
  // Claude models
  'claude-opus-4-6': ['tools', 'vision', 'streaming'],
  'claude-sonnet-4-6': ['tools', 'vision', 'streaming'],
  'claude-haiku-4-5-20251001': ['vision', 'streaming'],
  // OpenAI models (subscription)
  'gpt-4.1': ['tools', 'vision', 'streaming'],
  'gpt-5.4': ['tools', 'vision', 'streaming'],
  'o3': ['tools', 'vision', 'streaming'],
  'o4-mini': ['streaming'],
  // Gemini models (subscription)
  'gemini-2.5-pro': ['tools', 'vision', 'streaming'],
  'gemini-2.5-flash': ['vision', 'streaming'],
  'gemini-2.0-flash': ['vision', 'streaming'],
  // OpenRouter models (prefixed)
  'google/gemini-3.1-pro-preview': ['tools', 'vision', 'streaming'],
  'google/gemini-3-flash-preview': ['vision', 'streaming'],
  'qwen/qwen3.5-plus-02-15': ['tools', 'streaming'],
  'qwen/qwen3-coder-next': ['tools', 'streaming'],
  'deepseek/deepseek-v3.2': ['tools', 'streaming'],
  'minimax/minimax-m2.5': ['streaming'],
  'z-ai/glm-5': ['tools', 'streaming'],
  'moonshotai/kimi-k2.5': ['tools', 'streaming'],
  'openai/gpt-5.4': ['tools', 'vision', 'streaming'],
  'anthropic/claude-opus-4-6': ['tools', 'vision', 'streaming'],
  'anthropic/claude-sonnet-4-6': ['tools', 'vision', 'streaming'],
  'anthropic/claude-haiku-4-5-20251001': ['vision', 'streaming'],
  // Kimi models
  'kimi-k2.5': ['tools', 'streaming'],
  'kimi-k2': ['streaming'],
}

/** Look up capabilities for a model ID (tries exact match, then normalized) */
function getModelCapabilities(modelId: string): ModelCapability[] {
  if (MODEL_CAPABILITIES[modelId]) return MODEL_CAPABILITIES[modelId]
  const normalized = normalizeProviderModelId(modelId)
  if (MODEL_CAPABILITIES[normalized]) return MODEL_CAPABILITIES[normalized]
  return []
}

// ─── Claude Effort Options ───────────────────────────────────────────────────

const CLAUDE_EFFORT_OPTIONS: Array<{ value: ChatEffortLevel; label: string; shortLabel: string }> = [
  { value: 'default', label: 'Default', shortLabel: 'Auto' },
  { value: 'low', label: 'Low', shortLabel: 'L' },
  { value: 'medium', label: 'Medium', shortLabel: 'M' },
  { value: 'high', label: 'High', shortLabel: 'H' },
]

// ─── Model Aliases ────────────────────────────────────────────────────────────

interface ModelAlias {
  model: string
  provider?: string
  description: string
}

const MODEL_ALIASES: Record<string, ModelAlias> = {
  best: { model: 'claude-opus-4-6', provider: 'claude-subscription', description: 'Claude Opus 4.6' },
  fast: { model: 'claude-haiku-4-5-20251001', provider: 'claude-subscription', description: 'Claude Haiku 4.5' },
  cheap: { model: 'google/gemini-3-flash-preview', provider: 'openrouter', description: 'Gemini 3 Flash' },
  smart: { model: 'google/gemini-3.1-pro-preview', provider: 'openrouter', description: 'Gemini 3.1 Pro' },
  code: { model: 'qwen/qwen3-coder-next', provider: 'openrouter', description: 'Qwen3 Coder Next' },
}

/** Resolve a model alias to the real model value, or return the original */
export function resolveModelAlias(modelValue: string): string {
  const alias = MODEL_ALIASES[modelValue]
  return alias ? alias.model : modelValue
}

/** Check if a model supports vision (images) */
export function modelHasVision(modelValue: string): boolean {
  const resolved = resolveModelAlias(modelValue)
  const caps = getModelCapabilities(resolved)
  if (caps.includes('vision')) return true
  return modelSupportsVisionById(resolved)
}

export function modelSupportsClaudeEffort(modelValue: string): boolean {
  return modelSupportsClaudeEffortById(resolveModelAlias(modelValue))
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

/** Build alias entries filtered by connected providers */
function getAliasOptions(
  connectedProviderIds: Set<string>,
): (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] {
  return Object.entries(MODEL_ALIASES)
    .filter(([, alias]) => {
      // Only show alias if its target provider is connected
      if (alias.provider && !connectedProviderIds.has(alias.provider)) return false
      return true
    })
    .map(([name, alias]) => {
      return {
        value: `__alias__${name}`,
        label: `${name}`,
        provider: alias.provider,
        capabilities: getModelCapabilities(alias.model),
        _aliasTarget: alias.model,
        _aliasDescription: alias.description,
      }
    })
}

/** Build grouped model options from dynamic provider model groups */
function buildModelGroups(
  modelGroups: ProviderModelGroup[],
  connectedProviderIds: Set<string>,
): { group: string; models: (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] }[] {
  const groups: { group: string; models: (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] }[] = []

  // Quick Aliases (filtered by connected providers)
  const aliases = getAliasOptions(connectedProviderIds)
  if (aliases.length > 0) {
    groups.push({ group: 'Quick Aliases', models: aliases })
  }

  // Each connected provider as a group
  for (const pg of modelGroups) {
    const models: ChatModelOption[] = pg.models.map((m) => ({
      value: m.id,
      label: m.name,
      provider: pg.providerId,
      capabilities: getModelCapabilities(m.id),
    }))

    if (models.length > 0) {
      groups.push({ group: pg.providerName, models })
    }
  }

  return groups
}

/** Get a human-friendly short name for a model ID */
export function getModelShortName(modelValue: string): string {
  // Check static capability map keys for a match
  const normalized = normalizeProviderModelId(modelValue)

  // Try to find in aliases first
  const resolvedModel = resolveModelAlias(modelValue)
  if (resolvedModel !== modelValue) {
    const resolvedNormalized = normalizeProviderModelId(resolvedModel)
    // Known model names for common models
    const knownNames = getKnownModelName(resolvedNormalized)
    if (knownNames) return knownNames
  }

  const knownName = getKnownModelName(normalized)
  if (knownName) return knownName

  // Fallback: strip provider prefix and clean up
  const parts = modelValue.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelValue.replace(/-\d{8,}$/, '')
}

/** Static map of known model IDs to display names */
const KNOWN_MODEL_NAMES: Record<string, string> = {
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gpt-4.1': 'GPT-4.1',
  'gpt-5.4': 'GPT-5.4',
  'o3': 'o3',
  'o4-mini': 'o4 Mini',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'gemini-3-flash-preview': 'Gemini 3 Flash',
  'qwen3.5-plus-02-15': 'Qwen 3.5 Plus',
  'qwen3-coder-next': 'Qwen3 Coder Next',
  'deepseek-v3.2': 'DeepSeek V3.2',
  'minimax-m2.5': 'MiniMax M2.5',
  'glm-5': 'GLM-5',
  'kimi-k2.5': 'Kimi K2.5',
  'kimi-k2': 'Kimi K2',
}

function getKnownModelName(normalizedId: string): string | null {
  return KNOWN_MODEL_NAMES[normalizedId] ?? null
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
  modelGroups: ProviderModelGroup[]
  connectedProviderIds: Set<string>
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
  modelGroups,
  connectedProviderIds,
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
  const isClaudeModel = normalizeProviderModelId(resolvedModel).startsWith('claude-')
  const showClaudeEffort =
    isClaudeModel &&
    connectedProviderIds.has('claude-subscription') &&
    modelSupportsClaudeEffort(chatModel)

  const hasAnyProvider = connectedProviderIds.size > 0
  const isSubscriptionProvider = aiProvider.endsWith('-subscription')

  // Build dynamic model groups from connected providers
  const displayGroups = buildModelGroups(modelGroups, connectedProviderIds)

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
            title={hasAnyProvider ? `Model: ${chatModel}` : 'No AI providers configured'}
          >
            <span className="flex items-center gap-1 min-w-0 flex-1">
              <Cpu size={10} className="shrink-0" />
              <span className="truncate">
                {hasAnyProvider ? getModelShortName(chatModel) : 'No providers'}
              </span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {isSubscriptionProvider && (
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
              {!hasAnyProvider ? (
                <div className="px-3 py-3 text-[11px] text-neutral-500 text-center">
                  Nenhum provider configurado.
                  <br />
                  <span className="text-neutral-600">Adicione em Settings &gt; Engine.</span>
                </div>
              ) : (
                displayGroups.map(({ group, models }) => (
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
                ))
              )}
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
