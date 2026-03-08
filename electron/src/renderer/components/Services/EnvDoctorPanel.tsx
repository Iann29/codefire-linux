import { useState } from 'react'
import {
  Stethoscope,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  Shield,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  FileCode2,
  Sparkles,
} from 'lucide-react'
import { api } from '@renderer/lib/api'

interface EnvDoctorIssue {
  severity: 'error' | 'warning' | 'info'
  code: 'missing' | 'unused' | 'undocumented' | 'suspicious_exposure'
  key: string
  title: string
  evidence: string[]
  remediation: string
}

interface EnvDoctorReport {
  generatedAt: number
  totalDefinitions: number
  totalUsages: number
  issues: EnvDoctorIssue[]
  score: number
}

interface EnvDoctorPanelProps {
  projectPath: string
}

// ─── Severity helpers ───────────────────────────────────────────────────────────

function severityIcon(severity: EnvDoctorIssue['severity']) {
  switch (severity) {
    case 'error':
      return <AlertCircle size={14} className="text-red-400 shrink-0" />
    case 'warning':
      return <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
    case 'info':
      return <Info size={14} className="text-blue-400 shrink-0" />
  }
}

function severityBg(severity: EnvDoctorIssue['severity']) {
  switch (severity) {
    case 'error':
      return 'border-red-900/40 bg-red-950/20'
    case 'warning':
      return 'border-yellow-900/40 bg-yellow-950/20'
    case 'info':
      return 'border-blue-900/40 bg-blue-950/20'
  }
}

function codeLabel(code: EnvDoctorIssue['code']) {
  switch (code) {
    case 'missing':
      return 'Missing'
    case 'unused':
      return 'Unused'
    case 'undocumented':
      return 'Undocumented'
    case 'suspicious_exposure':
      return 'Exposure Risk'
  }
}

function codeBadgeColor(code: EnvDoctorIssue['code']) {
  switch (code) {
    case 'missing':
      return 'bg-red-900/50 text-red-300'
    case 'unused':
      return 'bg-yellow-900/50 text-yellow-300'
    case 'undocumented':
      return 'bg-blue-900/50 text-blue-300'
    case 'suspicious_exposure':
      return 'bg-orange-900/50 text-orange-300'
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
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Good'
  if (score >= 60) return 'Fair'
  if (score >= 40) return 'Needs Attention'
  return 'Critical'
}

// ─── Issue Card ─────────────────────────────────────────────────────────────────

function IssueCard({ issue }: { issue: EnvDoctorIssue }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyKey = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(issue.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`rounded-lg border ${severityBg(issue.severity)} transition-colors`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 w-full p-2.5 text-left"
      >
        <div className="mt-0.5">{severityIcon(issue.severity)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono text-neutral-200 font-medium">
              {issue.key}
            </code>
            <span
              className={`text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${codeBadgeColor(issue.code)}`}
            >
              {codeLabel(issue.code)}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
            {issue.title}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <button
            type="button"
            onClick={handleCopyKey}
            className="p-1 rounded hover:bg-neutral-700/60 transition-colors"
            title="Copy key"
          >
            {copied ? (
              <CheckCircle2 size={12} className="text-green-400" />
            ) : (
              <Copy size={12} className="text-neutral-500 hover:text-neutral-300" />
            )}
          </button>
          {expanded ? (
            <ChevronDown size={12} className="text-neutral-500" />
          ) : (
            <ChevronRight size={12} className="text-neutral-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-0 border-t border-neutral-800/50">
          {/* Evidence */}
          {issue.evidence.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                Evidence
              </p>
              <div className="space-y-0.5">
                {issue.evidence.map((ev, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-[11px] text-neutral-400"
                  >
                    <FileCode2 size={10} className="text-neutral-600 shrink-0" />
                    <span className="truncate font-mono">{ev}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remediation */}
          <div className="mt-2 flex items-start gap-1.5">
            <Sparkles size={10} className="text-neutral-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-neutral-400 italic">
              {issue.remediation}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ─────────────────────────────────────────────────────────────────

export default function EnvDoctorPanel({ projectPath }: EnvDoctorPanelProps) {
  const [report, setReport] = useState<EnvDoctorReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runDiagnosis = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.envDoctor.analyze(projectPath)
      setReport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Not yet scanned ───────────────────────────────────────────────────────
  if (!report && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="p-3 bg-neutral-800/60 rounded-xl">
          <Stethoscope size={24} className="text-teal-400" />
        </div>
        <div className="text-center">
          <p className="text-xs text-neutral-300">
            Analyze environment variables for issues
          </p>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            Missing, unused, undocumented, and exposed secrets
          </p>
        </div>
        {error && (
          <p className="text-[10px] text-red-400 text-center">{error}</p>
        )}
        <button
          type="button"
          onClick={runDiagnosis}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors"
        >
          <Stethoscope size={12} />
          Run Diagnosis
        </button>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <Loader2 size={20} className="animate-spin text-teal-400" />
        <p className="text-[10px] text-neutral-500">Scanning project...</p>
      </div>
    )
  }

  // ── Report loaded ─────────────────────────────────────────────────────────
  if (!report) return null

  const errorCount = report.issues.filter((i) => i.severity === 'error').length
  const warningCount = report.issues.filter((i) => i.severity === 'warning').length
  const infoCount = report.issues.filter((i) => i.severity === 'info').length

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
        <div className="flex-1 grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-neutral-200">
              {report.totalDefinitions}
            </p>
            <p className="text-[9px] text-neutral-500">Defined</p>
          </div>
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-neutral-200">
              {report.totalUsages}
            </p>
            <p className="text-[9px] text-neutral-500">Usages</p>
          </div>
          <div className="bg-neutral-800/40 rounded px-2 py-1.5">
            <p className="text-xs font-medium text-neutral-200">
              {report.issues.length}
            </p>
            <p className="text-[9px] text-neutral-500">Issues</p>
          </div>
        </div>
      </div>

      {/* Severity summary pills */}
      {report.issues.length > 0 && (
        <div className="flex gap-2">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-950/30 px-2 py-0.5 rounded-full">
              <AlertCircle size={10} />
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-950/30 px-2 py-0.5 rounded-full">
              <AlertTriangle size={10} />
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </span>
          )}
          {infoCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-950/30 px-2 py-0.5 rounded-full">
              <Info size={10} />
              {infoCount} info
            </span>
          )}
        </div>
      )}

      {/* Issues list */}
      {report.issues.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-3">
          <CheckCircle2 size={20} className="text-green-400" />
          <p className="text-xs text-green-400">All env variables look healthy!</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {report.issues.map((issue, i) => (
            <IssueCard key={`${issue.code}-${issue.key}-${i}`} issue={issue} />
          ))}
        </div>
      )}

      {/* Re-run button */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={runDiagnosis}
          disabled={loading}
          className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <Stethoscope size={10} />
          Re-run diagnosis
        </button>
      </div>
    </div>
  )
}
