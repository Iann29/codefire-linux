import { useState } from 'react'
import {
  X,
  Key,
  Globe,
  UserCheck,
  ChevronLeft,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
  ExternalLink,
} from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { api } from '../../lib/api'

interface OnboardingWizardProps {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
  onClose: () => void
}

type Step = 'choose' | 'subscription' | 'apikey' | 'custom'

interface SubscriptionProvider {
  id: AppConfig['aiProvider']
  label: string
  description: string
}

const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = [
  { id: 'claude-subscription', label: 'Claude', description: 'Anthropic' },
  { id: 'openai-subscription', label: 'OpenAI', description: 'GPT models' },
  { id: 'gemini-subscription', label: 'Gemini', description: 'Google AI' },
  { id: 'kimi-subscription', label: 'Kimi', description: 'Moonshot AI' },
]

export default function OnboardingWizard({ config, onChange, onClose }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('choose')
  const [apiKey, setApiKey] = useState(config.openRouterKey || '')
  const [showKey, setShowKey] = useState(false)
  const [customUrl, setCustomUrl] = useState(config.customEndpointUrl || '')
  const [customKey, setCustomKey] = useState(config.customEndpointKey || '')
  const [showCustomKey, setShowCustomKey] = useState(false)
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null)
  const [connectedProvider, setConnectedProvider] = useState<string | null>(null)

  async function handleSubscriptionConnect(providerId: string) {
    setConnectingProvider(providerId)
    try {
      await api.provider.startOAuth(providerId)
      // Verify the connection
      const accounts = await api.provider.listAccounts()
      const match = accounts?.find((a) => a.providerId === providerId)
      if (match) {
        setConnectedProvider(providerId)
        onChange({ aiProvider: providerId as AppConfig['aiProvider'] })
        await api.settings.set({ aiProvider: providerId as AppConfig['aiProvider'] })
        setTimeout(() => onClose(), 1200)
      }
    } catch {
      // OAuth was cancelled or failed — stay on the page
    } finally {
      setConnectingProvider(null)
    }
  }

  function handleApiKeySave() {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    onChange({ aiProvider: 'openrouter', openRouterKey: trimmed })
    api.settings.set({ aiProvider: 'openrouter', openRouterKey: trimmed }).then(() => onClose())
  }

  function handleCustomSave() {
    const trimmedUrl = customUrl.trim()
    if (!trimmedUrl) return
    onChange({
      aiProvider: 'custom',
      customEndpointUrl: trimmedUrl,
      customEndpointKey: customKey.trim(),
    })
    api.settings
      .set({
        aiProvider: 'custom',
        customEndpointUrl: trimmedUrl,
        customEndpointKey: customKey.trim(),
      })
      .then(() => onClose())
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[560px] max-h-[85vh] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            {step !== 'choose' && (
              <button
                onClick={() => setStep('choose')}
                className="p-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <h2 className="text-sm font-semibold text-neutral-200">
              {step === 'choose' && 'Connect to AI'}
              {step === 'subscription' && 'Use your AI subscription'}
              {step === 'apikey' && 'OpenRouter API Key'}
              {step === 'custom' && 'Custom Endpoint'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            title="Skip for now"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {step === 'choose' && <ChooseStep onSelect={setStep} />}
          {step === 'subscription' && (
            <SubscriptionStep
              providers={SUBSCRIPTION_PROVIDERS}
              connectingProvider={connectingProvider}
              connectedProvider={connectedProvider}
              onConnect={handleSubscriptionConnect}
            />
          )}
          {step === 'apikey' && (
            <ApiKeyStep
              apiKey={apiKey}
              showKey={showKey}
              onKeyChange={setApiKey}
              onToggleShow={() => setShowKey(!showKey)}
              onSave={handleApiKeySave}
            />
          )}
          {step === 'custom' && (
            <CustomEndpointStep
              url={customUrl}
              apiKey={customKey}
              showKey={showCustomKey}
              onUrlChange={setCustomUrl}
              onKeyChange={setCustomKey}
              onToggleShow={() => setShowCustomKey(!showCustomKey)}
              onSave={handleCustomSave}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 border-t border-neutral-800">
          <p className="text-[10px] text-neutral-600 text-center">
            You can change this anytime in Settings &gt; Engine
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Choose Step ──────────────────────────────────────────────────────────── */

function ChooseStep({ onSelect }: { onSelect: (step: Step) => void }) {
  const options: Array<{
    step: Step
    icon: typeof Key
    title: string
    description: string
  }> = [
    {
      step: 'subscription',
      icon: UserCheck,
      title: 'Use your AI subscription',
      description: 'Sign in with Claude, OpenAI, Gemini, or Kimi. Uses your existing subscription.',
    },
    {
      step: 'apikey',
      icon: Key,
      title: 'Use OpenRouter API key',
      description:
        'Access hundreds of models through OpenRouter. Pay-per-token, no subscription required.',
    },
    {
      step: 'custom',
      icon: Globe,
      title: 'Use custom endpoint',
      description:
        'Connect to Ollama, LM Studio, LiteLLM, or any OpenAI-compatible API endpoint.',
    },
  ]

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 mb-4">
        Choose how CodeFire connects to AI models for chat, summaries, and agent features.
      </p>
      {options.map((opt) => {
        const Icon = opt.icon
        return (
          <button
            key={opt.step}
            onClick={() => onSelect(opt.step)}
            className="w-full flex items-start gap-4 px-4 py-3.5 rounded-lg bg-neutral-800/60 border border-neutral-700
                       hover:border-codefire-orange/40 hover:bg-neutral-800 transition-all text-left group"
          >
            <div className="mt-0.5 p-2 rounded-md bg-neutral-700/60 group-hover:bg-codefire-orange/10 transition-colors">
              <Icon
                size={18}
                className="text-neutral-400 group-hover:text-codefire-orange transition-colors"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-neutral-200 font-medium group-hover:text-codefire-orange transition-colors">
                {opt.title}
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                {opt.description}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ─── Subscription Step ───────────────────────────────────────────────────── */

function SubscriptionStep({
  providers,
  connectingProvider,
  connectedProvider,
  onConnect,
}: {
  providers: SubscriptionProvider[]
  connectingProvider: string | null
  connectedProvider: string | null
  onConnect: (providerId: string) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 mb-4">
        Sign in with your existing AI subscription. An OAuth window will open for authentication.
      </p>
      {providers.map((p) => {
        const isConnecting = connectingProvider === p.id
        const isConnected = connectedProvider === p.id
        const isDisabled = connectingProvider !== null && !isConnecting

        return (
          <div
            key={p.id}
            className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
              isConnected
                ? 'bg-green-500/5 border-green-500/30'
                : 'bg-neutral-800/60 border-neutral-700'
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm text-neutral-200 font-medium">{p.label}</p>
              <p className="text-[10px] text-neutral-500">{p.description}</p>
            </div>
            {isConnected ? (
              <span className="flex items-center gap-1.5 text-xs text-green-400 shrink-0">
                <CheckCircle size={14} />
                Connected
              </span>
            ) : (
              <button
                onClick={() => onConnect(p.id)}
                disabled={isDisabled}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-codefire-orange/30
                           text-codefire-orange hover:bg-codefire-orange/10 transition-colors
                           disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                {isConnecting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── API Key Step ────────────────────────────────────────────────────────── */

function ApiKeyStep({
  apiKey,
  showKey,
  onKeyChange,
  onToggleShow,
  onSave,
}: {
  apiKey: string
  showKey: boolean
  onKeyChange: (v: string) => void
  onToggleShow: () => void
  onSave: () => void
}) {
  const isValid = apiKey.trim().length > 0

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-400">
        Enter your OpenRouter API key. You can get one at{' '}
        <button
          type="button"
          onClick={() => window.api.invoke('shell:openExternal' as never, 'https://openrouter.ai/keys')}
          className="text-codefire-orange hover:underline inline-flex items-center gap-0.5"
        >
          openrouter.ai/keys
          <ExternalLink size={10} />
        </button>
      </p>

      <div className="space-y-1.5">
        <label className="text-xs text-neutral-500 block">API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onKeyChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && isValid && onSave()}
            placeholder="sk-or-..."
            autoFocus
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2
                       text-xs text-neutral-200 placeholder:text-neutral-600
                       focus:outline-none focus:border-codefire-orange/50"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-neutral-600">
          Used for embeddings, chat, agent, and image generation.
        </p>
      </div>

      <button
        onClick={onSave}
        disabled={!isValid}
        className="w-full py-2 rounded text-xs font-medium bg-codefire-orange/20 text-codefire-orange
                   hover:bg-codefire-orange/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save and continue
      </button>
    </div>
  )
}

/* ─── Custom Endpoint Step ────────────────────────────────────────────────── */

function CustomEndpointStep({
  url,
  apiKey,
  showKey,
  onUrlChange,
  onKeyChange,
  onToggleShow,
  onSave,
}: {
  url: string
  apiKey: string
  showKey: boolean
  onUrlChange: (v: string) => void
  onKeyChange: (v: string) => void
  onToggleShow: () => void
  onSave: () => void
}) {
  const isValid = url.trim().length > 0

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-400">
        Connect to any OpenAI-compatible API endpoint. Works with Ollama, LM Studio, LiteLLM,
        and other local or remote providers.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs text-neutral-500 block">Endpoint URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="http://localhost:11434/v1"
          autoFocus
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2
                     text-xs text-neutral-200 placeholder:text-neutral-600
                     focus:outline-none focus:border-codefire-orange/50"
        />
        <p className="text-[10px] text-neutral-600">
          Base URL of the API (e.g. http://localhost:11434/v1 for Ollama)
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-neutral-500 block">API Key (optional)</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onKeyChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && isValid && onSave()}
            placeholder="sk-..."
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2
                       text-xs text-neutral-200 placeholder:text-neutral-600
                       focus:outline-none focus:border-codefire-orange/50"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-neutral-600">
          Leave empty if your endpoint does not require authentication.
        </p>
      </div>

      <button
        onClick={onSave}
        disabled={!isValid}
        className="w-full py-2 rounded text-xs font-medium bg-codefire-orange/20 text-codefire-orange
                   hover:bg-codefire-orange/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save and continue
      </button>
    </div>
  )
}
