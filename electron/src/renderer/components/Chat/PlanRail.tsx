interface PlanStep {
  title: string
  status: 'pending' | 'done' | 'blocked'
}

interface PlanRailProps {
  steps: PlanStep[]
  awaitingVerification: boolean
  lastBrowserAction: string | null
}

export default function PlanRail({
  steps,
  awaitingVerification,
  lastBrowserAction,
}: PlanRailProps) {
  if (steps.length === 0) return null

  const doneCount = steps.filter((step) => step.status === 'done').length

  return (
    <div className="rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-2.5 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">Plan</span>
        <span className="text-[10px] text-neutral-500">{doneCount}/{steps.length} done</span>
      </div>

      <div className="space-y-1">
        {steps.map((step, index) => (
          <div key={`${step.title}-${index}`} className="flex items-start gap-2">
            <span className={`mt-0.5 text-[10px] ${
              step.status === 'done'
                ? 'text-green-400'
                : step.status === 'blocked'
                  ? 'text-red-400'
                  : 'text-neutral-500'
            }`}>
              {step.status === 'done' ? '✓' : step.status === 'blocked' ? '!' : '•'}
            </span>
            <span className={`text-[10px] leading-snug ${
              step.status === 'done'
                ? 'text-neutral-300'
                : step.status === 'blocked'
                  ? 'text-red-300'
                  : 'text-neutral-400'
            }`}>
              {step.title}
            </span>
          </div>
        ))}
      </div>

      {awaitingVerification && (
        <div className="mt-2 rounded border border-amber-800/60 bg-amber-900/20 px-2 py-1">
          <p className="text-[10px] text-amber-300 leading-snug">
            Verifique a última ação ({lastBrowserAction || 'browser action'}) com `browser_dom_map` ou `browser_get_element_info`, depois marque o passo com `update_plan`.
          </p>
        </div>
      )}
    </div>
  )
}
