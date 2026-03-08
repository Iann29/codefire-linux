import { useState } from 'react'
import {
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  Shield,
  Search,
  FileText,
  Terminal,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react'
import type { AuditReport, AuditFinding, AuditCategory, AuditSeverity } from './types'

interface AuditPanelProps {
  report: AuditReport
  onClose: () => void
}

const CATEGORY_META: Record<AuditCategory, { label: string; icon: React.ReactNode }> = {
  seo: { label: 'SEO', icon: <Search size={13} /> },
  accessibility: { label: 'Accessibility', icon: <Eye size={13} /> },
  content: { label: 'Content Structure', icon: <FileText size={13} /> },
  runtime: { label: 'Runtime', icon: <Terminal size={13} /> },
  assets: { label: 'Assets', icon: <Shield size={13} /> },
}

const SEVERITY_STYLES: Record<AuditSeverity, { bg: string; text: string; border: string; label: string }> = {
  blocker: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', label: 'Blocker' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', label: 'Warning' },
  info: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', label: 'Info' },
}

function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const style = SEVERITY_STYLES[severity]
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${style.bg} ${style.text} ${style.border} border`}>
      {severity === 'blocker' && <AlertCircle size={10} />}
      {severity === 'warning' && <AlertTriangle size={10} />}
      {severity === 'info' && <Info size={10} />}
      {style.label}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  let color = 'text-green-400 bg-green-500/10 border-green-500/30'
  if (score < 50) color = 'text-red-400 bg-red-500/10 border-red-500/30'
  else if (score < 80) color = 'text-amber-400 bg-amber-500/10 border-amber-500/30'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-bold border ${color}`}>
      {score}
    </span>
  )
}

function FindingItem({ finding }: { finding: AuditFinding }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-neutral-800 rounded mb-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-neutral-800/40 transition-colors"
      >
        {expanded
          ? <ChevronDown size={12} className="text-neutral-500 shrink-0" />
          : <ChevronRight size={12} className="text-neutral-500 shrink-0" />
        }
        <SeverityBadge severity={finding.severity} />
        <span className="text-[11px] text-neutral-300 truncate flex-1">{finding.title}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 pt-1 border-t border-neutral-800 space-y-2">
          <p className="text-[11px] text-neutral-400 leading-relaxed">{finding.description}</p>

          {finding.evidence && (
            <div className="bg-neutral-950 rounded px-2 py-1.5">
              <span className="text-[9px] text-neutral-600 uppercase tracking-wider block mb-0.5">Evidence</span>
              <pre className="text-[10px] text-neutral-400 whitespace-pre-wrap break-all font-mono">{finding.evidence}</pre>
            </div>
          )}

          {finding.selector && (
            <div>
              <span className="text-[9px] text-neutral-600 uppercase tracking-wider">Selector: </span>
              <code className="text-[10px] text-amber-400/80 font-mono">{finding.selector}</code>
            </div>
          )}

          <div className="bg-neutral-800/50 rounded px-2 py-1.5">
            <span className="text-[9px] text-neutral-600 uppercase tracking-wider block mb-0.5">How to fix</span>
            <p className="text-[11px] text-neutral-300 leading-relaxed">{finding.remediation}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AuditPanel({ report, onClose }: AuditPanelProps) {
  const grouped = new Map<AuditCategory, AuditFinding[]>()
  for (const f of report.findings) {
    const arr = grouped.get(f.category) || []
    arr.push(f)
    grouped.set(f.category, arr)
  }

  // Sort categories: show ones with findings first
  const categoryOrder: AuditCategory[] = ['seo', 'accessibility', 'content', 'runtime', 'assets']
  const sortedCategories = categoryOrder.filter(c => grouped.has(c))

  return (
    <div className="h-72 border-t border-neutral-800 bg-neutral-900 flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Shield size={14} className="text-codefire-orange" />
            <span className="text-[11px] font-medium text-neutral-200">Page Audit</span>
          </div>
          <ScoreBadge score={report.summary.score} />
          <div className="flex items-center gap-2 text-[10px]">
            {report.summary.blockers > 0 && (
              <span className="text-red-400">{report.summary.blockers} blocker{report.summary.blockers > 1 ? 's' : ''}</span>
            )}
            {report.summary.warnings > 0 && (
              <span className="text-amber-400">{report.summary.warnings} warning{report.summary.warnings > 1 ? 's' : ''}</span>
            )}
            {report.summary.infos > 0 && (
              <span className="text-blue-400">{report.summary.infos} info{report.summary.infos > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {report.findings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500">
            <Shield size={24} className="mb-2 text-green-400" />
            <p className="text-xs">No issues found. Great job!</p>
          </div>
        ) : (
          sortedCategories.map(cat => {
            const findings = grouped.get(cat)!
            const meta = CATEGORY_META[cat]
            return (
              <div key={cat} className="mb-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-neutral-500">{meta.icon}</span>
                  <span className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider">{meta.label}</span>
                  <span className="text-[9px] text-neutral-600">({findings.length})</span>
                </div>
                {findings.map(f => (
                  <FindingItem key={f.id} finding={f} />
                ))}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1 border-t border-neutral-800 shrink-0">
        <span className="text-[9px] text-neutral-600">
          {report.url} &middot; {new Date(report.generatedAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}
