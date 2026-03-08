export type AuditSeverity = 'blocker' | 'warning' | 'info'
export type AuditCategory = 'seo' | 'accessibility' | 'content' | 'runtime' | 'assets'

export interface AuditFinding {
  id: string
  severity: AuditSeverity
  category: AuditCategory
  title: string
  description: string
  evidence?: string
  selector?: string
  remediation: string
}

export interface AuditReport {
  url: string
  pageTitle: string
  generatedAt: number
  findings: AuditFinding[]
  summary: {
    blockers: number
    warnings: number
    infos: number
    score: number
  }
}
