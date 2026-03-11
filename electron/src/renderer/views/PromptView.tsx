import { useState, useEffect, useCallback } from 'react'
import { Loader2, Copy, Check, AlertTriangle, Sparkles, RotateCcw } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { usePromptCompiler } from '@renderer/hooks/usePromptCompiler'

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

export default function PromptView({ projectId }: PromptViewProps) {
  void projectId

  const [brief, setBrief] = useState('')
  const [corrections, setCorrections] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [copied, setCopied] = useState(false)

  const {
    clarification,
    generation,
    clarifying,
    generating,
    warning,
    mode,
    clarify,
    generate,
    reset,
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
        // No provider configured — model select will be empty
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClarify = useCallback(async () => {
    if (!brief.trim()) return
    await clarify(brief, selectedModel || undefined).catch(() => {})
  }, [brief, selectedModel, clarify])

  const handleGenerate = useCallback(async () => {
    if (!clarification) return
    await generate(brief, corrections, clarification, selectedModel || undefined).catch(() => {})
  }, [brief, corrections, clarification, selectedModel, generate])

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-codefire-orange" />
          <h2 className="text-title text-neutral-200 font-medium">Prompt Compiler</h2>
          {mode && (
            <span className={`text-tiny px-1.5 py-0.5 rounded-cf ${
              mode === 'ai'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-yellow-500/10 text-yellow-400'
            }`}>
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

      {/* Main content — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
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
              {models.length === 0 && (
                <option value="">Nenhum provider configurado</option>
              )}
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
              Fase 1 — Entendimento
            </h3>

            <Card title="Entendimento">
              <p className="text-xs text-neutral-400 leading-relaxed">
                {clarification.understanding}
              </p>
            </Card>

            <Card title="Objetivo">
              <BulletList items={clarification.objective} empty="Objetivo nao identificado." />
            </Card>

            <Card title="Contexto">
              <BulletList items={clarification.context} empty="Nenhum contexto identificado." />
            </Card>

            <Card title="Restricoes">
              <BulletList items={clarification.constraints} empty="Nenhuma restricao informada." />
            </Card>

            <Card title="Suposicoes">
              <BulletList items={clarification.assumptions} empty="Sem suposicoes." />
            </Card>

            {clarification.questions.length > 0 && (
              <Card title="Perguntas">
                <BulletList items={clarification.questions} empty="" />
              </Card>
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
                Fase 2 — Prompt Final
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
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
        <li key={i} className="list-disc">{item}</li>
      ))}
    </ul>
  )
}
