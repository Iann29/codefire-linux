import { useState, useCallback } from 'react'
import {
  X,
  FileText,
  Loader2,
  Copy,
  Check,
  Save,
  ChevronDown,
  Sparkles,
  Search,
  Pencil,
  MousePointerClick,
  HelpCircle,
  Image,
} from 'lucide-react'
import { api } from '@renderer/lib/api'

interface ContentPack {
  id: string
  type: 'seo' | 'copy' | 'cta' | 'faq' | 'og-concept'
  title: string
  content: string
  routePath: string | null
  generatedAt: number
}

interface ContentStudioSheetProps {
  projectId: string
  pageUrl: string
  pageTitle: string
  getActiveWebview: () => any | null
  onClose: () => void
}

const PACK_TYPES = [
  { value: 'seo', label: 'SEO Pack', icon: Search, description: 'Meta tags, keywords, structured data' },
  { value: 'copy', label: 'Copy Pack', icon: Pencil, description: 'Headlines, CTAs, body copy' },
  { value: 'cta', label: 'CTA Pack', icon: MousePointerClick, description: '5 CTA variations with different tones' },
  { value: 'faq', label: 'FAQ Pack', icon: HelpCircle, description: 'FAQ entries with schema markup' },
  { value: 'og-concept', label: 'OG Concept', icon: Image, description: 'Social image concepts and copy' },
] as const

export default function ContentStudioSheet({
  projectId,
  pageUrl,
  pageTitle,
  getActiveWebview,
  onClose,
}: ContentStudioSheetProps) {
  const [selectedType, setSelectedType] = useState<string>('seo')
  const [generating, setGenerating] = useState(false)
  const [pack, setPack] = useState<ContentPack | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const selectedTypeInfo = PACK_TYPES.find((t) => t.value === selectedType)

  const extractDomSummary = useCallback(async (): Promise<string> => {
    const webview = getActiveWebview()
    if (!webview) return ''

    try {
      const text = await webview.executeJavaScript(`
        (() => {
          const selectors = ['h1', 'h2', 'h3', 'p', 'li', 'meta[name="description"]'];
          const parts = [];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              if (sel.startsWith('meta')) {
                const content = el.getAttribute('content');
                if (content) parts.push(content);
              } else {
                const text = el.textContent?.trim();
                if (text && text.length > 10) parts.push(text);
              }
              if (parts.length > 30) break;
            }
            if (parts.length > 30) break;
          }
          return parts.join(' ').slice(0, 2000);
        })()
      `)
      return typeof text === 'string' ? text : ''
    } catch {
      return ''
    }
  }, [getActiveWebview])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    setPack(null)
    setSaved(false)

    try {
      const domSummary = await extractDomSummary()

      const project = await api.projects.get(projectId)
      const projectName = project?.name || 'Project'

      const result = await api.contentStudio.generatePack({
        type: selectedType,
        pageTitle,
        pageUrl,
        domSummary,
        projectName,
      })

      setPack(result as ContentPack)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate content pack')
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    if (!pack) return
    try {
      await navigator.clipboard.writeText(pack.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may not be available
    }
  }

  async function handleSaveAsNote() {
    if (!pack) return
    setSaving(true)
    try {
      await api.notes.create({
        projectId,
        title: pack.title,
        content: pack.content,
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-[600px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            <span className="text-sm font-medium text-neutral-200">Content Studio</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Page context */}
          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500 uppercase tracking-wider">Current Page</label>
            <div className="text-xs text-neutral-400 font-mono bg-neutral-800 rounded px-2 py-1.5 truncate">
              {pageUrl}
            </div>
            <div className="text-xs text-neutral-300 truncate">{pageTitle}</div>
          </div>

          {/* Pack type selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-neutral-500 uppercase tracking-wider">Pack Type</label>
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-xs text-neutral-200 hover:border-neutral-600 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {selectedTypeInfo && <selectedTypeInfo.icon size={14} className="text-amber-400" />}
                  <span>{selectedTypeInfo?.label}</span>
                  <span className="text-neutral-500">-- {selectedTypeInfo?.description}</span>
                </div>
                <ChevronDown size={14} className={`text-neutral-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-800 border border-neutral-700 rounded shadow-xl z-10">
                  {PACK_TYPES.map((type) => {
                    const Icon = type.icon
                    return (
                      <button
                        key={type.value}
                        onClick={() => {
                          setSelectedType(type.value)
                          setDropdownOpen(false)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-neutral-700 transition-colors ${
                          selectedType === type.value ? 'bg-neutral-700/50 text-amber-400' : 'text-neutral-300'
                        }`}
                      >
                        <Icon size={14} className={selectedType === type.value ? 'text-amber-400' : 'text-neutral-500'} />
                        <span className="font-medium">{type.label}</span>
                        <span className="text-neutral-500">-- {type.description}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded transition-colors disabled:opacity-40"
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate {selectedTypeInfo?.label}
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Generated content */}
          {pack && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-amber-400" />
                  <span className="text-xs font-medium text-neutral-200">{pack.title}</span>
                </div>
                <span className="text-[10px] text-neutral-600">
                  {new Date(pack.generatedAt).toLocaleTimeString()}
                </span>
              </div>

              {/* Content preview */}
              <div className="bg-neutral-800 border border-neutral-700 rounded max-h-[40vh] overflow-y-auto p-4">
                <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {pack.content}
                </pre>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 rounded transition-colors"
                >
                  {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>

                <button
                  onClick={handleSaveAsNote}
                  disabled={saving || saved}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded transition-colors disabled:opacity-40"
                >
                  {saving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : saved ? (
                    <Check size={13} className="text-green-400" />
                  ) : (
                    <Save size={13} />
                  )}
                  {saved ? 'Saved' : 'Save as Note'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
