import { useState, useEffect } from 'react'
import {
  Globe,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Copy,
  Cloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  Rocket,
} from 'lucide-react'
import { api } from '@renderer/lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PreviewEnvironment {
  id: string
  provider: string | null
  branch: string | null
  prNumber: number | null
  prTitle: string | null
  previewUrl: string | null
  productionUrl: string | null
  status: 'active' | 'unknown' | 'manual'
  source: 'config' | 'github' | 'manual'
  commitSha: string | null
  updatedAt: number
}

interface DiscoveryResult {
  provider: string | null
  currentBranch: string | null
  environments: PreviewEnvironment[]
  productionUrl: string | null
}

interface PreviewEnvironmentsPanelProps {
  projectPath: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function providerLabel(provider: string | null): string {
  switch (provider) {
    case 'vercel':
      return 'Vercel'
    case 'netlify':
      return 'Netlify'
    case 'firebase':
      return 'Firebase'
    default:
      return 'Unknown'
  }
}

function providerColor(provider: string | null): string {
  switch (provider) {
    case 'vercel':
      return 'bg-neutral-700 text-white'
    case 'netlify':
      return 'bg-teal-900/60 text-teal-300'
    case 'firebase':
      return 'bg-amber-900/60 text-amber-300'
    default:
      return 'bg-neutral-800 text-neutral-400'
  }
}

function sourceBadge(source: PreviewEnvironment['source']): {
  label: string
  className: string
} {
  switch (source) {
    case 'config':
      return { label: 'Config', className: 'bg-blue-900/50 text-blue-300' }
    case 'github':
      return { label: 'GitHub', className: 'bg-purple-900/50 text-purple-300' }
    case 'manual':
      return { label: 'Manual', className: 'bg-neutral-700 text-neutral-300' }
  }
}

// ─── Environment Card ────────────────────────────────────────────────────────

function EnvironmentCard({
  env,
  isCurrentBranch,
}: {
  env: PreviewEnvironment
  isCurrentBranch: boolean
}) {
  const [copied, setCopied] = useState(false)
  const url = env.productionUrl || env.previewUrl
  const isProduction = env.id === 'production'

  const handleCopy = () => {
    if (!url) return
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleOpen = () => {
    if (!url) return
    window.open(url, '_blank')
  }

  const source = sourceBadge(env.source)

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        isProduction
          ? 'border-green-900/40 bg-green-950/10'
          : isCurrentBranch
            ? 'border-cyan-900/40 bg-cyan-950/10'
            : 'border-neutral-800 bg-neutral-800/40'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        {isProduction ? (
          <Rocket size={13} className="text-green-400 shrink-0" />
        ) : env.prNumber ? (
          <GitPullRequest size={13} className="text-purple-400 shrink-0" />
        ) : (
          <GitBranch size={13} className="text-cyan-400 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isProduction ? (
              <span className="text-xs font-medium text-green-300">Production</span>
            ) : env.prNumber ? (
              <span className="text-xs font-medium text-neutral-200">
                #{env.prNumber}
              </span>
            ) : null}

            {env.branch && !isProduction && (
              <code className="text-[10px] font-mono text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded">
                {env.branch}
              </code>
            )}

            {isCurrentBranch && !isProduction && (
              <span className="text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300">
                current
              </span>
            )}

            <span
              className={`text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${source.className}`}
            >
              {source.label}
            </span>
          </div>
        </div>
      </div>

      {/* PR title */}
      {env.prTitle && (
        <p className="text-[11px] text-neutral-400 mb-1.5 truncate pl-5">
          {env.prTitle}
        </p>
      )}

      {/* URL row */}
      <div className="flex items-center gap-1.5 pl-5">
        {url ? (
          <>
            <button
              type="button"
              onClick={handleOpen}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 truncate transition-colors font-mono"
              title={url}
            >
              {url.replace(/^https?:\/\//, '')}
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={handleOpen}
                className="p-1 rounded hover:bg-neutral-700/60 transition-colors"
                title="Open in browser"
              >
                <ExternalLink
                  size={11}
                  className="text-neutral-500 hover:text-neutral-300"
                />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 rounded hover:bg-neutral-700/60 transition-colors"
                title="Copy URL"
              >
                {copied ? (
                  <CheckCircle2 size={11} className="text-green-400" />
                ) : (
                  <Copy
                    size={11}
                    className="text-neutral-500 hover:text-neutral-300"
                  />
                )}
              </button>
            </div>
          </>
        ) : (
          <span className="text-[10px] text-neutral-600 italic">
            Preview URL not resolved
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Manual URL Input ────────────────────────────────────────────────────────

function ManualUrlInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (val: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const handleSave = () => {
    onChange(draft.trim())
    setEditing(false)
  }

  const handleCancel = () => {
    setDraft(value)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') handleCancel()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        <Plus size={10} />
        {value ? `${label}: ${value}` : label}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus
        className="flex-1 text-[11px] bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-cyan-700"
      />
      <button
        type="button"
        onClick={handleSave}
        className="p-1 rounded bg-cyan-700 hover:bg-cyan-600 transition-colors"
        title="Save"
      >
        <CheckCircle2 size={11} className="text-white" />
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="p-1 rounded hover:bg-neutral-700 transition-colors"
        title="Cancel"
      >
        <X size={11} className="text-neutral-400" />
      </button>
    </div>
  )
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export default function PreviewEnvironmentsPanel({
  projectPath,
}: PreviewEnvironmentsPanelProps) {
  const [result, setResult] = useState<DiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualPreviewUrl, setManualPreviewUrl] = useState('')
  const [manualProductionUrl, setManualProductionUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    async function discover() {
      setLoading(true)
      setError(null)

      try {
        // Gather git status
        let gitInfo: { branch: string; isClean: boolean } | undefined
        try {
          const status = await api.git.status(projectPath)
          gitInfo = { branch: status.branch, isClean: status.isClean }
        } catch {
          // Git not available
        }

        // Gather GitHub info
        let githubInfo:
          | {
              owner: string
              repo: string
              prs: Array<{
                number: number
                title: string
                head_branch: string
                state: string
              }>
            }
          | undefined
        try {
          const repoInfo = await api.github.getRepoInfo(projectPath)
          if (repoInfo) {
            const prs = await api.github.listPRs(repoInfo.owner, repoInfo.repo, {
              state: 'OPEN',
              limit: 20,
            })
            githubInfo = {
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              prs: prs.map(
                (pr: {
                  number: number
                  title: string
                  headRefName: string
                  state: string
                }) => ({
                  number: pr.number,
                  title: pr.title,
                  head_branch: pr.headRefName,
                  state: pr.state,
                })
              ),
            }
          }
        } catch {
          // GitHub not configured / no token
        }

        // Discover environments
        const discovery = await api.preview.discover(
          projectPath,
          gitInfo,
          githubInfo
        )

        if (!cancelled) {
          setResult(discovery)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Discovery failed')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    discover()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <Loader2 size={20} className="animate-spin text-cyan-400" />
        <p className="text-[10px] text-neutral-500">Discovering environments...</p>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <AlertCircle size={20} className="text-red-400" />
        <p className="text-[10px] text-red-400 text-center">{error}</p>
      </div>
    )
  }

  // ── Merge manual URLs into environments ────────────────────────────────────
  const environments = [...(result?.environments ?? [])]

  // If user set a manual production URL and there's no production entry, add one
  if (manualProductionUrl) {
    const prodEnv = environments.find((e) => e.id === 'production')
    if (prodEnv) {
      prodEnv.productionUrl = manualProductionUrl
      prodEnv.status = 'manual'
    } else {
      environments.unshift({
        id: 'production',
        provider: result?.provider ?? null,
        branch: 'main',
        prNumber: null,
        prTitle: null,
        previewUrl: null,
        productionUrl: manualProductionUrl,
        status: 'manual',
        source: 'manual',
        commitSha: null,
        updatedAt: Date.now(),
      })
    }
  }

  // If user set a manual preview URL for the current branch
  if (manualPreviewUrl && result?.currentBranch) {
    const branchEnv = environments.find(
      (e) => e.branch === result.currentBranch && e.id !== 'production'
    )
    if (branchEnv) {
      branchEnv.previewUrl = manualPreviewUrl
      branchEnv.status = 'manual'
    } else {
      environments.push({
        id: `manual-${result.currentBranch}`,
        provider: result?.provider ?? null,
        branch: result.currentBranch,
        prNumber: null,
        prTitle: null,
        previewUrl: manualPreviewUrl,
        productionUrl: null,
        status: 'manual',
        source: 'manual',
        commitSha: null,
        updatedAt: Date.now(),
      })
    }
  }

  // Sort: production first, then current branch, then PRs
  const sorted = environments.sort((a, b) => {
    if (a.id === 'production') return -1
    if (b.id === 'production') return 1
    if (a.branch === result?.currentBranch && b.branch !== result?.currentBranch)
      return -1
    if (b.branch === result?.currentBranch && a.branch !== result?.currentBranch)
      return 1
    return 0
  })

  const hasProvider = !!result?.provider

  return (
    <div className="space-y-3">
      {/* Provider header */}
      <div className="flex items-center gap-2">
        {hasProvider ? (
          <span
            className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded ${providerColor(result?.provider ?? null)}`}
          >
            <Cloud size={11} />
            {providerLabel(result?.provider ?? null)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] text-neutral-500 px-2 py-1 rounded bg-neutral-800/60">
            <Cloud size={11} />
            No provider detected
          </span>
        )}

        {result?.currentBranch && (
          <span className="flex items-center gap-1 text-[10px] text-neutral-400">
            <GitBranch size={10} />
            <code className="font-mono">{result.currentBranch}</code>
          </span>
        )}
      </div>

      {/* Environments list */}
      {sorted.length > 0 ? (
        <div className="space-y-1.5">
          {sorted.map((env) => (
            <EnvironmentCard
              key={env.id}
              env={env}
              isCurrentBranch={
                env.branch === result?.currentBranch && env.id !== 'production'
              }
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 py-3">
          <Globe size={20} className="text-neutral-600" />
          <p className="text-[10px] text-neutral-500 text-center">
            No environments detected.
            <br />
            Use the inputs below to add URLs manually.
          </p>
        </div>
      )}

      {/* Manual URL inputs */}
      <div className="space-y-1.5 pt-1 border-t border-neutral-800/50">
        <ManualUrlInput
          label="Set production URL"
          placeholder="https://myapp.vercel.app"
          value={manualProductionUrl}
          onChange={setManualProductionUrl}
        />
        {result?.currentBranch &&
          result.currentBranch !== 'main' &&
          result.currentBranch !== 'master' && (
            <ManualUrlInput
              label={`Set preview URL for ${result.currentBranch}`}
              placeholder="https://myapp-branch-xyz.vercel.app"
              value={manualPreviewUrl}
              onChange={setManualPreviewUrl}
            />
          )}
      </div>
    </div>
  )
}
