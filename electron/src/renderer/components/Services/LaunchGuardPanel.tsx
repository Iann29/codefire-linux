import { useState } from 'react'
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  SkipForward,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  GitBranch,
  KeyRound,
  Globe,
  Search,
} from 'lucide-react'
import { api } from '@renderer/lib/api'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface LaunchCheck {
  id: string
  category: 'git' | 'env' | 'routes' | 'seo' | 'browser' | 'ci'
  status: 'pass' | 'warn' | 'fail' | 'skipped'
  title: string
  evidence: string
  remediation: string
}

interface LaunchReport {
  generatedAt: number
  branch: string | null
  totalChecks: number
  passCount: number
  warnCount: number
  failCount: number
  skipCount: number
  checks: LaunchCheck[]
  score: number
}

interface LaunchGuardPanelProps {
  projectPath: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function statusIcon(status: LaunchCheck['status']) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={14} className="text-green-400 shrink-0" />
    case 'warn':
      return <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
    case 'fail':
      return <AlertCircle size={14} className="text-red-400 shrink-0" />
    case 'skipped':
      return <SkipForward size={14} className="text-neutral-500 shrink-0" />
  }
}

function statusBg(status: LaunchCheck['status']) {
  switch (status) {
    case 'pass':
      return 'border-green-900/40 bg-green-950/20'
    case 'warn':
      return 'border-yellow-900/40 bg-yellow-950/20'
    case 'fail':
      return 'border-red-900/40 bg-red-950/20'
    case 'skipped':
      return 'border-neutral-800 bg-neutral-800/20'
  }
}

function statusLabel(status: LaunchCheck['status']) {
  switch (status) {
    case 'pass':
      return 'Pass'
    case 'warn':
      return 'Warning'
    case 'fail':
      return 'Fail'
    case 'skipped':
      return 'Skipped'
  }
}

function statusBadgeColor(status: LaunchCheck['status']) {
  switch (status) {
    case 'pass':
      return 'bg-green-900/50 text-green-300'
    case 'warn':
      return 'bg-yellow-900/50 text-yellow-300'
    case 'fail':
      return 'bg-red-900/50 text-red-300'
    case 'skipped':
      return 'bg-neutral-700/50 text-neutral-400'
  }
}

function categoryIcon(category: LaunchCheck['category']) {
  switch (category) {
    case 'git':
      return <GitBranch size={12} className="text-orange-400" />
    case 'env':
      return <KeyRound size={12} className="text-green-400" />
    case 'routes':
      return <Globe size={12} className="text-cyan-400" />
    case 'seo':
      return <Search size={12} className="text-purple-400" />
    default:
      return <Shield size={12} className="text-neutral-400" />
  }
}

function categoryLabel(category: LaunchCheck['category']) {
  switch (category) {
    case 'git':
      return 'Git'
    case 'env':
      return 'Environment'
    case 'routes':
      return 'Routes'
    case 'seo':
      return 'SEO'
    case 'browser':
      return 'Browser'
    case 'ci':
      return 'CI/CD'
  }
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function scoreBg(score: number) {
  if (score >= 80) return 'bg-green-950/30 border-green-900/40'
  if (score >= 50) return 'bg-yellow-950/30 border-yellow-900/40'
  return 'bg-red-950/30 border-red-900/40'
}

function scoreLabel(score: number) {
  if (score >= 90) return 'Ready'
  if (score >= 80) return 'Almost Ready'
  if (score >= 60) return 'Needs Work'
  if (score >= 40) return 'Not Ready'
  return 'Critical'
}

function scoreBarColor(score: number) {
  if (score >= 80) return 'bg-green-500'
  if (score >= 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

// ─── Check Card ─────────────────────────────────────────────────────────────────

function CheckCard({ check }: { check: LaunchCheck }) {
  const [expanded, setExpanded] = useState(check.status === 'fail' || check.status === 'warn')

  const hasDetails = check.remediation || check.evidence

  return (
    <div className={`rounded-lg border ${statusBg(check.status)} transition-colors`}>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex items-start gap-2 w-full p-2.5 text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="mt-0.5">{statusIcon(check.status)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-neutral-200 leading-relaxed">{check.title}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <span
            className={`text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${statusBadgeColor(check.status)}`}
          >
            {statusLabel(check.status)}
          </span>
          {hasDetails && (
            expanded ? (
              <ChevronDown size={12} className="text-neutral-500" />
            ) : (
              <ChevronRight size={12} className="text-neutral-500" />
            )
          )}
        </div>
      </button>

      {expanded && hasDetails && (
        <div className="px-2.5 pb-2.5 pt-0 border-t border-neutral-800/50">
          {check.evidence && (
            <div className="mt-2">
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                Evidence
              </p>
              <p className="text-[11px] text-neutral-400 font-mono">{check.evidence}</p>
            </div>
          )}
          {check.remediation && (
            <div className="mt-2 flex items-start gap-1.5">
              <Sparkles size={10} className="text-neutral-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-neutral-400 italic">{check.remediation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Category Group ─────────────────────────────────────────────────────────────

function CategoryGroup({
  category,
  checks,
}: {
  category: LaunchCheck['category']
  checks: LaunchCheck[]
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {categoryIcon(category)}
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
          {categoryLabel(category)}
        </span>
        <span className="text-[10px] text-neutral-600">
          ({checks.filter((c) => c.status === 'pass').length}/{checks.length})
        </span>
      </div>
      <div className="space-y-1.5">
        {checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>
    </div>
  )
}

// ─── Main Panel ─────────────────────────────────────────────────────────────────

export default function LaunchGuardPanel({ projectPath }: LaunchGuardPanelProps) {
  const [report, setReport] = useState<LaunchReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runChecks = async () => {
    setLoading(true)
    setError(null)
    try {
      // Gather data from existing services in parallel
      const [gitStatus, envDoctorResult, routeResult] = await Promise.allSettled([
        api.git.status(projectPath),
        api.envDoctor.analyze(projectPath),
        api.routes.discover(projectPath),
      ])

      const inputs: Record<string, unknown> = { projectPath }

      if (gitStatus.status === 'fulfilled') {
        inputs.gitStatus = gitStatus.value
      }
      if (envDoctorResult.status === 'fulfilled') {
        inputs.envDoctorResult = envDoctorResult.value
      }
      if (routeResult.status === 'fulfilled') {
        inputs.routeResult = routeResult.value
      }

      const result = await api.launchGuard.run(inputs)
      setReport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch Guard check failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Not yet scanned ───────────────────────────────────────────────────────
  if (!report && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="p-3 bg-neutral-800/60 rounded-xl">
          <Shield size={24} className="text-indigo-400" />
        </div>
        <div className="text-center">
          <p className="text-xs text-neutral-300">Pre-launch readiness checklist</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            Checks git, env vars, routes, and SEO essentials
          </p>
        </div>
        {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
        <button
          type="button"
          onClick={runChecks}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          <Shield size={12} />
          Run Launch Guard
        </button>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <Loader2 size={20} className="animate-spin text-indigo-400" />
        <p className="text-[10px] text-neutral-500">Running pre-launch checks...</p>
      </div>
    )
  }

  // ── Report loaded ─────────────────────────────────────────────────────────
  if (!report) return null

  // Group checks by category
  const categories = ['git', 'env', 'routes', 'seo', 'browser', 'ci'] as const
  const groupedChecks = categories
    .map((cat) => ({
      category: cat,
      checks: report.checks.filter((c) => c.category === cat),
    }))
    .filter((g) => g.checks.length > 0)

  return (
    <div className="space-y-3">
      {/* Score + stats header */}
      <div className="flex items-center gap-3">
        {/* Score badge */}
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${scoreBg(report.score)}`}
        >
          <Shield size={16} className={scoreColor(report.score)} />
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-lg font-bold leading-none ${scoreColor(report.score)}`}>
                {report.score}
              </span>
              <span className="text-[10px] text-neutral-500">/100</span>
            </div>
            <p className={`text-[9px] ${scoreColor(report.score)}`}>
              {scoreLabel(report.score)}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 grid grid-cols-4 gap-1.5 text-center">
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-green-400">{report.passCount}</p>
            <p className="text-[9px] text-neutral-500">Pass</p>
          </div>
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-yellow-400">{report.warnCount}</p>
            <p className="text-[9px] text-neutral-500">Warn</p>
          </div>
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-red-400">{report.failCount}</p>
            <p className="text-[9px] text-neutral-500">Fail</p>
          </div>
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-neutral-400">{report.skipCount}</p>
            <p className="text-[9px] text-neutral-500">Skip</p>
          </div>
        </div>
      </div>

      {/* Score progress bar */}
      <div className="w-full bg-neutral-800 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${scoreBarColor(report.score)}`}
          style={{ width: `${report.score}%` }}
        />
      </div>

      {/* Branch info */}
      {report.branch && (
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
          <GitBranch size={10} />
          <span>Branch: {report.branch}</span>
        </div>
      )}

      {/* All checks pass */}
      {report.failCount === 0 && report.warnCount === 0 && (
        <div className="flex flex-col items-center gap-1.5 py-3">
          <CheckCircle2 size={20} className="text-green-400" />
          <p className="text-xs text-green-400">All checks passed! Ready to launch.</p>
        </div>
      )}

      {/* Grouped checks */}
      <div className="space-y-3">
        {groupedChecks.map((group) => (
          <CategoryGroup
            key={group.category}
            category={group.category}
            checks={group.checks}
          />
        ))}
      </div>

      {/* Re-run button */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={runChecks}
          disabled={loading}
          className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <Shield size={10} />
          Re-run checks
        </button>
      </div>
    </div>
  )
}
