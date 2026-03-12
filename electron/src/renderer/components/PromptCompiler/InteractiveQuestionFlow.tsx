import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react'
import type { PromptInteractiveAnswer, PromptInteractiveQuestion } from '@shared/promptCompiler'
import {
  buildAnswerPreview,
  findFirstIncompleteQuestionId,
  getAnsweredQuestionCount,
  getQuestionAnswer,
  isQuestionComplete,
  type PromptAnswerMap,
} from '@renderer/lib/promptCompilerFlow'

interface InteractiveQuestionFlowProps {
  questions: PromptInteractiveQuestion[]
  answers: PromptAnswerMap
  onAnswerChange: (answer: PromptInteractiveAnswer) => void
}

export function InteractiveQuestionFlow({
  questions,
  answers,
  onAnswerChange,
}: InteractiveQuestionFlowProps) {
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(questions[0]?.id ?? null)
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const nextActiveId =
      questions.find((question) => question.id === activeQuestionId)?.id ??
      findFirstIncompleteQuestionId(questions, answers) ??
      questions[0]?.id ??
      null

    setActiveQuestionId(nextActiveId)
    setOtherOpen((prev) => {
      const nextState: Record<string, boolean> = {}
      for (const question of questions) {
        const answer = answers[question.id]
        nextState[question.id] = prev[question.id] ?? Boolean(answer?.otherText.trim())
      }
      return nextState
    })
  }, [questions, answers, activeQuestionId])

  const activeIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === activeQuestionId)
  )
  const activeQuestion = questions[activeIndex]
  const answeredCount = useMemo(
    () => getAnsweredQuestionCount(questions, answers),
    [questions, answers]
  )

  if (!questions.length || !activeQuestion) {
    return null
  }

  const activeAnswer = getQuestionAnswer(answers, activeQuestion.id)

  const updateAnswer = (question: PromptInteractiveQuestion, nextAnswer: PromptInteractiveAnswer) => {
    const previousAnswer = getQuestionAnswer(answers, question.id)
    const wasComplete = isQuestionComplete(question, previousAnswer)
    const isCompleteNow = isQuestionComplete(question, nextAnswer)

    onAnswerChange(nextAnswer)

    if (!wasComplete && isCompleteNow) {
      const currentIndex = questions.findIndex((item) => item.id === question.id)
      const nextQuestion = questions.find((item, index) => {
        if (index <= currentIndex) return false
        return !isQuestionComplete(item, answers[item.id])
      })

      if (nextQuestion) {
        setActiveQuestionId(nextQuestion.id)
      }
    }
  }

  const setOtherOpenState = (questionId: string, open: boolean) => {
    setOtherOpen((prev) => ({ ...prev, [questionId]: open }))
  }

  const renderPrimaryControl = (question: PromptInteractiveQuestion, answer: PromptInteractiveAnswer) => {
    if (question.responseType === 'text') {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-tiny text-neutral-500">
            <span className="px-1.5 py-0.5 rounded-cf border border-neutral-700 bg-neutral-900/60 text-neutral-300">
              Resposta livre / Outro
            </span>
            <span>Escreva da forma que fizer mais sentido.</span>
          </div>

          <textarea
            value={answer.textValue}
            onChange={(event) =>
              updateAnswer(question, {
                ...answer,
                textValue: event.target.value,
              })
            }
            rows={4}
            placeholder={question.inputPlaceholder || question.otherPlaceholder}
            className="w-full bg-neutral-900/70 border border-neutral-700 rounded-cf px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 resize-y focus:outline-none focus:border-codefire-orange/50 focus:ring-1 focus:ring-codefire-orange/20"
          />
        </div>
      )
    }

    const isMulti = question.responseType === 'multi'

    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => {
            const selected = answer.selectedOptionIds.includes(option.id)

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  const selectedOptionIds = isMulti
                    ? selected
                      ? answer.selectedOptionIds.filter((id) => id !== option.id)
                      : [...answer.selectedOptionIds, option.id]
                    : selected
                      ? []
                      : [option.id]

                  updateAnswer(question, {
                    ...answer,
                    selectedOptionIds,
                    otherText: isMulti ? answer.otherText : '',
                  })

                  if (!isMulti) {
                    setOtherOpenState(question.id, false)
                  }
                }}
                className={`rounded-cf border p-3 text-left transition-colors focus:outline-none focus:border-codefire-orange/50 focus:ring-1 focus:ring-codefire-orange/20 ${
                  selected
                    ? 'border-codefire-orange/50 bg-codefire-orange/10 text-neutral-100'
                    : 'border-neutral-700 bg-neutral-900/70 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-900'
                }`}
                aria-pressed={selected}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-codefire-orange">
                    {selected ? <Check size={14} /> : <Circle size={14} />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{option.label}</div>
                    {option.description && (
                      <p className="mt-1 text-xs text-neutral-500 leading-relaxed">
                        {option.description}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="rounded-cf border border-dashed border-neutral-700 bg-neutral-900/50 p-3 space-y-2">
          <button
            type="button"
            onClick={() => {
              const nextOpen = !(otherOpen[question.id] || Boolean(answer.otherText.trim()))
              setOtherOpenState(question.id, nextOpen)

              if (!nextOpen) {
                updateAnswer(question, {
                  ...answer,
                  otherText: '',
                })
                return
              }

              if (!isMulti && answer.selectedOptionIds.length > 0) {
                updateAnswer(question, {
                  ...answer,
                  selectedOptionIds: [],
                })
              }
            }}
            className={`inline-flex items-center gap-2 rounded-cf px-2.5 py-1.5 text-xs transition-colors ${
              otherOpen[question.id] || Boolean(answer.otherText.trim())
                ? 'bg-codefire-orange/12 text-codefire-orange border border-codefire-orange/30'
                : 'bg-neutral-800 border border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            <MessageSquarePlus size={12} />
            {otherOpen[question.id] || Boolean(answer.otherText.trim()) ? 'Fechar outro' : 'Outro'}
          </button>

          {(otherOpen[question.id] || Boolean(answer.otherText.trim())) && (
            <textarea
              value={answer.otherText}
              onChange={(event) =>
                updateAnswer(question, {
                  ...answer,
                  otherText: event.target.value,
                })
              }
              rows={3}
              placeholder={question.otherPlaceholder || question.inputPlaceholder}
              className="w-full bg-neutral-900/70 border border-neutral-700 rounded-cf px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 resize-y focus:outline-none focus:border-codefire-orange/50 focus:ring-1 focus:ring-codefire-orange/20"
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-cf border border-codefire-orange/20 bg-[linear-gradient(135deg,rgba(255,122,26,0.14),rgba(23,23,23,0.88))] p-3 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-codefire-orange">
              <Sparkles size={12} />
              Perguntas guiadas
            </div>
            <p className="text-sm text-neutral-100 leading-relaxed">
              A IA transformou as lacunas reais do briefing em um mini fluxo interativo. As suas
              respostas alimentam a proxima etapa automaticamente.
            </p>
          </div>

          <div className="min-w-[148px] space-y-1 rounded-cf border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex items-center justify-between text-tiny text-neutral-300">
              <span>Progresso</span>
              <span>
                {answeredCount}/{questions.length}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-codefire-orange transition-all"
                style={{ width: `${(answeredCount / questions.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {questions.map((question, index) => {
            const answered = isQuestionComplete(question, answers[question.id])
            const active = question.id === activeQuestion.id

            return (
              <button
                key={question.id}
                type="button"
                onClick={() => setActiveQuestionId(question.id)}
                className={`min-w-[180px] rounded-cf border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-codefire-orange/50 bg-black/30 text-neutral-100'
                    : answered
                      ? 'border-green-500/25 bg-green-500/10 text-neutral-100'
                      : 'border-white/10 bg-black/15 text-neutral-300 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-tiny">
                  <span>Pergunta {index + 1}</span>
                  {answered ? <Check size={12} className="text-green-400" /> : <Circle size={12} />}
                </div>
                <div className="mt-1 text-xs font-medium line-clamp-2">{question.label}</div>
                <div className="mt-1 text-tiny text-neutral-500 line-clamp-2">
                  {buildAnswerPreview(question, answers[question.id])}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-cf border border-neutral-700 bg-neutral-800/50 p-3 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-full bg-codefire-orange/15 text-codefire-orange w-6 h-6 text-xs font-medium">
                {activeIndex + 1}
              </span>
              <h4 className="text-sm font-medium text-neutral-100">{activeQuestion.label}</h4>
            </div>
            {activeQuestion.helperText && (
              <p className="text-xs text-neutral-500 leading-relaxed">{activeQuestion.helperText}</p>
            )}
          </div>

          <span
            className={`text-tiny px-2 py-1 rounded-cf border ${
              activeQuestion.required
                ? 'border-codefire-orange/30 bg-codefire-orange/10 text-codefire-orange'
                : 'border-neutral-700 bg-neutral-900/60 text-neutral-400'
            }`}
          >
            {activeQuestion.required ? 'Obrigatoria' : 'Opcional'}
          </span>
        </div>

        {renderPrimaryControl(activeQuestion, activeAnswer)}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setActiveQuestionId(questions[Math.max(activeIndex - 1, 0)]?.id ?? null)}
            disabled={activeIndex === 0}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={12} />
            Voltar
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveQuestionId(
                questions[Math.min(activeIndex + 1, questions.length - 1)]?.id ?? activeQuestion.id
              )
            }
            disabled={activeIndex === questions.length - 1}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Avancar
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
