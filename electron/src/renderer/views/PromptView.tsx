import { useState, useEffect, useCallback } from 'react'
import {
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  GitBranch,
  ListChecks,
  Cpu,
  BookOpen,
} from 'lucide-react'
import { api } from '@renderer/lib/api'
import { usePromptCompiler } from '@renderer/hooks/usePromptCompiler'
import type { ContextToggles } from '@renderer/hooks/usePromptCompiler'
import type { ProjectContext } from '@shared/models'

interface PromptViewProps {
  projectId: string
}

const SAMPLE_BRIEFS: Record<string, { label: string; brief: string }> = {
  coding: {
    label: 'Coding',
    brief: 'preciso refatorar um componente React que ficou baguncado, mas sem mudar o layout nem o comportamento. O projeto usa Next.js com TypeScript, tem risco de regressao visual e eu quero um prompt forte para outra IA fazer isso com seguranca. Se faltar contexto critico, ela deve perguntar antes de mexer.',
  },
  debug: {
    label: 'Debug',
    brief: 'tenho um bug intermitente de login que so aparece em producao. Quero um prompt para outra IA investigar com metodo, sem sair chutando causa raiz, separando fatos de hipoteses e propondo passos claros de verificacao. O sistema eh um SaaS web com Next.js no front e Node no backend.',
  },
  writing: {
    label: 'Writing',
    brief: 'preciso transformar uma ideia meio confusa num texto de apresentacao para possivel investidor. O produto ainda esta validando proposta de valor, eu quero soar claro e maduro sem parecer hype demais, e preciso de um prompt que faca outra IA escrever isso com objetividade e confianca.',
  },
}

const DEFAULT_TOGGLES: ContextToggles = {
  techStack: true,
  gitBranch: true,
  tasks: true,
  memories: true,
}

export default function PromptView({ projectId }: PromptViewProps) {
  const [brief, setBrief] = useState('')
  const [corrections, setCorrections] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [copied, setCopied] = useState(false)
  const [contextOpen, setContextOpen] = useState(true)
  const [toggles, setToggles] = useState<ContextToggles>(DEFAULT_TOGGLES)

  const {
    clarification,
    generation,
    clarifying,
    generating,
    warning,
    mode,
    projectContext,
    contextLoading,
    clarify,
    generate,
    reset,
    fetchContext,
  } = usePromptCompiler()

  // Load available models from provider
  useEffect(() => {
    api.provider
      .listModels()
      .then((list) => {
        setModels(list)
        if (list.length > 0 && !selectedModel) {
          setSelectedModel(list[0].id)
        }
      })
      .catch(() => {
        // No provider configured
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch project context on mount
  useEffect(() => {
    if (projectId) {
      fetchContext(projectId)
    }
  }, [projectId, fetchContext])

  const handleClarify = useCallback(async () => {
    if (!brief.trim()) return
    await clarify(brief, selectedModel || undefined, toggles).catch(() => {})
  }, [brief, selectedModel, clarify, toggles])

  const handleGenerate = useCallback(async () => {
    if (!clarification) return
    await generate(brief, corrections, clarification, selectedModel || undefined, toggles).catch(
      () => {}
    )
  }, [brief, corrections, clarification, selectedModel, generate, toggles])

  const handleCopy = useCallback(async () => {
    if (!generation?.finalPrompt) return
    await navigator.clipboard.writeText(generation.finalPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [generation])

  const handleReset = useCallback(() => {
    setBrief('')
    setCorrections('')
    reset()
  }, [reset])

  const handleSampleClick = useCallback((key: string) => {
    const sample = SAMPLE_BRIEFS[key]
    if (sample) setBrief(sample.brief)
  }, [])

  const handleToggle = useCallback((key: keyof ContextToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleRefreshContext = useCallback(() => {
    if (projectId) fetchContext(projectId)
  }, [projectId, fetchContext])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-codefire-orange" />
          <h2 className="text-title text-neutral-200 font-medium">Prompt Compiler</h2>
          {mode && (
            <span
              className={`text-tiny px-1.5 py-0.5 rounded-cf ${
                mode === 'ai'
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {mode === 'ai' ? 'AI' : 'Demo'}
            </span>
          )}
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <RotateCcw size={12} />
          Limpar
        </button>
      </div>

      {/* Warning banner */}
      {warning && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-cf bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300 flex items-start gap-2 shrink-0">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {/* Main content -- scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
        {/* Project Context Panel */}
        {projectContext && (
          <ProjectContextPanel
            context={projectContext}
            loading={contextLoading}
            open={contextOpen}
            toggles={toggles}
            onToggleOpen={() => setContextOpen((o) => !o)}
            onToggle={handleToggle}
            onRefresh={handleRefreshContext}
          />
        )}

        {/* Context loading skeleton */}
        {contextLoading && !projectContext && (
          <div className="bg-neutral-800/40 border border-neutral-800 rounded-cf p-3 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-neutral-500" />
            <span className="text-xs text-neutral-500">Carregando contexto do projeto...</span>
          </div>
        )}

        {/* Input section */}
        <section className="space-y-2">
          <label className="block">
            <span className="text-xs font-medium text-neutral-400">Briefing original</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              placeholder="Escreve tudo num bloco so. Objetivo, contexto, stack, restricoes e formato podem vir misturados."
              className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-cf px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 resize-y focus:outline-none focus:border-codefire-orange/50 focus:ring-1 focus:ring-codefire-orange/20"
            />
          </label>

          {/* Samples */}
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(SAMPLE_BRIEFS).map(([key, { label }]) => (
              <button
                key={key}
                onClick={() => handleSampleClick(key)}
                className="text-tiny px-2 py-1 rounded-cf border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Model selector */}
          <label className="block">
            <span className="text-xs font-medium text-neutral-400">Modelo AI</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-cf px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange/50 focus:ring-1 focus:ring-codefire-orange/20"
            >
              {models.length === 0 && <option value="">Nenhum provider configurado</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {/* Clarify button */}
          <button
            onClick={handleClarify}
            disabled={!brief.trim() || clarifying}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-cf text-sm font-medium bg-codefire-orange text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {clarifying ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Interpretando...
              </>
            ) : (
              'Interpretar intencao'
            )}
          </button>
        </section>

        {/* Clarification section */}
        {clarification && (
          <section className="space-y-2 border-t border-neutral-800 pt-3">
            <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
              Fase 1 -- Entendimento
            </h3>

            <InfoCard title="Entendimento">
              <p className="text-xs text-neutral-400 leading-relaxed">
                {clarification.understanding}
              </p>
            </InfoCard>

            <InfoCard title="Objetivo">
              <BulletList items={clarification.objective} empty="Objetivo nao identificado." />
            </InfoCard>

            <InfoCard title="Contexto">
              <BulletList items={clarification.context} empty="Nenhum contexto identificado." />
            </InfoCard>

            <InfoCard title="Restricoes">
              <BulletList items={clarification.constraints} empty="Nenhuma restricao informada." />
            </InfoCard>

            <InfoCard title="Suposicoes">
              <BulletList items={clarification.assumptions} empty="Sem suposicoes." />
            </InfoCard>

            {clarification.questions.length > 0 && (
              <InfoCard title="Perguntas">
                <BulletList items={clarification.questions} empty="" />
              </InfoCard>
            )}

            {/* Confirmation block */}
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-cf p-3 space-y-2">
              <p className="text-xs text-neutral-300">{clarification.confirmationPrompt}</p>

              <label className="block">
                <span className="text-xs font-medium text-neutral-400">Ajustes ou respostas</span>
                <textarea
                  value={corrections}
                  onChange={(e) => setCorrections(e.target.value)}
                  rows={3}
                  placeholder="Ex.: pode assumir Next.js 15 e TypeScript. O comportamento tambem precisa continuar igual."
                  className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-cf px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 resize-y focus:outline-none focus:border-codefire-orange/50 focus:ring-1 focus:ring-codefire-orange/20"
                />
              </label>

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-cf text-sm font-medium bg-neutral-700 border border-neutral-600 text-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-600 transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Gerando...
                  </>
                ) : (
                  'Confirmar e gerar prompt final'
                )}
              </button>
            </div>
          </section>
        )}

        {/* Generation section */}
        {generation && (
          <section className="space-y-2 border-t border-neutral-800 pt-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                Fase 2 -- Prompt Final
              </h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={12} className="text-green-400" />
                    <span className="text-green-400">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    Copiar
                  </>
                )}
              </button>
            </div>

            <textarea
              value={generation.finalPrompt}
              readOnly
              rows={18}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-cf px-3 py-2 text-sm text-neutral-200 resize-y font-mono leading-relaxed focus:outline-none"
            />
          </section>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ProjectContextPanel({
  context,
  loading,
  open,
  toggles,
  onToggleOpen,
  onToggle,
  onRefresh,
}: {
  context: ProjectContext
  loading: boolean
  open: boolean
  toggles: ContextToggles
  onToggleOpen: () => void
  onToggle: (key: keyof ContextToggles) => void
  onRefresh: () => void
}) {
  const enabledCount = Object.values(toggles).filter(Boolean).length

  return (
    <div className="bg-neutral-800/40 border border-neutral-800 rounded-cf overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggleOpen}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-neutral-800/60 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown size={12} className="text-neutral-500 shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-neutral-500 shrink-0" />
          )}
          <span className="text-xs font-medium text-neutral-300 truncate">
            Contexto: {context.projectName}
          </span>
          {context.gitBranch && (
            <span className="flex items-center gap-1 text-tiny px-1.5 py-0.5 rounded-cf bg-blue-500/10 text-blue-400 shrink-0">
              <GitBranch size={10} />
              {context.gitBranch}
            </span>
          )}
          <span className="text-tiny text-neutral-600 shrink-0">{enabledCount}/4</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRefresh()
          }}
          disabled={loading}
          className="p-1 text-neutral-600 hover:text-neutral-300 transition-colors"
          title="Recarregar contexto"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </button>

      {/* Body */}
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-neutral-800">
          {/* Tech Stack */}
          <ContextToggleRow
            icon={<Cpu size={12} />}
            label="Tech Stack"
            enabled={toggles.techStack}
            onToggle={() => onToggle('techStack')}
            isEmpty={context.techStack.length === 0}
          >
            {context.techStack.length > 0 ? (
              <div className="flex gap-1 flex-wrap mt-1">
                {context.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="text-tiny px-1.5 py-0.5 rounded-cf bg-neutral-700/60 text-neutral-400"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-tiny text-neutral-600 italic mt-1">Nenhuma detectada</span>
            )}
          </ContextToggleRow>

          {/* Git Branch */}
          <ContextToggleRow
            icon={<GitBranch size={12} />}
            label="Branch"
            enabled={toggles.gitBranch}
            onToggle={() => onToggle('gitBranch')}
            isEmpty={!context.gitBranch}
          >
            <span className="text-tiny text-neutral-400 mt-1">
              {context.gitBranch || 'Sem repositorio git'}
            </span>
          </ContextToggleRow>

          {/* Tasks */}
          <ContextToggleRow
            icon={<ListChecks size={12} />}
            label={`Tasks abertas (${context.openTasks.length})`}
            enabled={toggles.tasks}
            onToggle={() => onToggle('tasks')}
            isEmpty={context.openTasks.length === 0}
          >
            {context.openTasks.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {context.openTasks.slice(0, 8).map((t, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-tiny text-neutral-400">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.status === 'in_progress' ? 'bg-blue-400' : 'bg-neutral-600'
                      }`}
                    />
                    <span className="truncate">{t.title}</span>
                    <span className="text-neutral-600 shrink-0">({t.priority})</span>
                  </li>
                ))}
                {context.openTasks.length > 8 && (
                  <li className="text-tiny text-neutral-600">
                    +{context.openTasks.length - 8} mais...
                  </li>
                )}
              </ul>
            ) : (
              <span className="text-tiny text-neutral-600 italic mt-1">Nenhuma task aberta</span>
            )}
          </ContextToggleRow>

          {/* Memories */}
          <ContextToggleRow
            icon={<BookOpen size={12} />}
            label={`Memorias (${context.memories.length})`}
            enabled={toggles.memories}
            onToggle={() => onToggle('memories')}
            isEmpty={context.memories.length === 0}
          >
            {context.memories.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {context.memories.slice(0, 4).map((m, i) => (
                  <li key={i} className="text-tiny">
                    <span className="text-neutral-300 font-medium">{m.name}</span>
                    <p className="text-neutral-600 line-clamp-2 break-all">{m.snippet}</p>
                  </li>
                ))}
                {context.memories.length > 4 && (
                  <li className="text-tiny text-neutral-600">
                    +{context.memories.length - 4} mais...
                  </li>
                )}
              </ul>
            ) : (
              <span className="text-tiny text-neutral-600 italic mt-1">Nenhuma memoria</span>
            )}
          </ContextToggleRow>
        </div>
      )}
    </div>
  )
}

function ContextToggleRow({
  icon,
  label,
  enabled,
  onToggle,
  isEmpty,
  children,
}: {
  icon: React.ReactNode
  label: string
  enabled: boolean
  onToggle: () => void
  isEmpty: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`pt-2 ${isEmpty ? 'opacity-50' : ''}`}>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          disabled={isEmpty}
          className="w-3 h-3 rounded border-neutral-600 bg-neutral-800 text-codefire-orange focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed"
        />
        <span className="text-neutral-500">{icon}</span>
        <span className="text-xs text-neutral-400">{label}</span>
      </label>
      {enabled && <div className="ml-[22px]">{children}</div>}
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-800/40 border border-neutral-800 rounded-cf p-2.5">
      <h4 className="text-xs font-medium text-neutral-300 mb-1.5">{title}</h4>
      {children}
    </div>
  )
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) {
    return <p className="text-xs text-neutral-600 italic">{empty}</p>
  }

  return (
    <ul className="space-y-0.5 text-xs text-neutral-400 leading-relaxed pl-3">
      {items.map((item, i) => (
        <li key={i} className="list-disc">
          {item}
        </li>
      ))}
    </ul>
  )
}
