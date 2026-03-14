import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { MessageSquare, ArrowLeft, X } from 'lucide-react'
import type { IndexProgress, IndexState, Project } from '@shared/models'
import { api } from '@renderer/lib/api'
import { useNavigation } from '@renderer/App'
import TabBar from '@renderer/components/TabBar/TabBar'
import CodeFireChat from '@renderer/components/Chat/CodeFireChat'
import BriefingDrawer from '@renderer/components/Dashboard/BriefingDrawer'
import AgentStatusBar from '@renderer/components/StatusBar/AgentStatusBar'
import { ProjectHeaderLeft, ProjectHeaderRight } from '@renderer/components/Header/ProjectHeaderBar'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
import { RecordingProvider } from '@renderer/hooks/useGlobalRecording'
import FloatingRecordButton from '@renderer/components/Recordings/FloatingRecordButton'
import logoIcon from '../../../resources/icon.png'
import { chatComposerStore } from '@renderer/stores/chatComposerStore'

// Eager: default tab (Tasks) and lightweight views
import TasksView from '@renderer/views/TasksView'
import DashboardView from '@renderer/views/DashboardView'
import NotesView from '@renderer/views/NotesView'

// Lazy: heavy views (CodeMirror, xterm, markdown editor, browser webview)
const SessionsView = lazy(() => import('@renderer/views/SessionsView'))
const FilesView = lazy(() => import('@renderer/views/FilesView'))
const MemoryView = lazy(() => import('@renderer/views/MemoryView'))
const ServicesView = lazy(() => import('@renderer/views/ServicesView'))
const RulesView = lazy(() => import('@renderer/views/RulesView'))
const GitView = lazy(() => import('@renderer/views/GitView'))
const ImagesView = lazy(() => import('@renderer/views/ImagesView'))
const RecordingsView = lazy(() => import('@renderer/views/RecordingsView'))
const BrowserView = lazy(() => import('@renderer/views/BrowserView'))
const VisualizerView = lazy(() => import('@renderer/views/VisualizerView'))
const TerminalView = lazy(() => import('@renderer/views/TerminalView'))
const PromptView = lazy(() => import('@renderer/views/PromptView'))

interface ProjectLayoutProps {
  projectId: string
}

const RECENT_REINDEX_WINDOW_MS = 5 * 60 * 1000

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function getProgressPercent(progress: IndexProgress | null): number | undefined {
  if (!progress) return undefined

  switch (progress.phase) {
    case 'enumerating':
      return progress.filesTotal > 0 ? 5 : 0
    case 'indexing':
      return progress.filesTotal > 0
        ? Math.min(85, Math.round((progress.filesProcessed / progress.filesTotal) * 85))
        : 10
    case 'embedding':
      if (progress.embeddingsTotal === 0) return 90
      return Math.min(
        98,
        85 + Math.round((progress.embeddingsGenerated / progress.embeddingsTotal) * 13)
      )
    case 'finalizing':
      return 100
    default:
      return undefined
  }
}

export default function ProjectLayout({ projectId }: ProjectLayoutProps) {
  const { navigateHome } = useNavigation()
  const [project, setProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState('Tasks')
  const [hasOpenedTerminal, setHasOpenedTerminal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle')
  const [indexTotalChunks, setIndexTotalChunks] = useState<number | undefined>()
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [indexLastError, setIndexLastError] = useState<string | undefined>()
  const [showBriefing, setShowBriefing] = useState(false)
  const [showChat, setShowChat] = useState(false)

  const syncIndexState = useCallback((state: IndexState | null) => {
    if (!state) {
      setIndexStatus('idle')
      setIndexTotalChunks(undefined)
      setIndexLastError(undefined)
      setIndexProgress(null)
      return
    }

    const nextStatus = ['idle', 'indexing', 'ready', 'error'].includes(state.status)
      ? state.status as 'idle' | 'indexing' | 'ready' | 'error'
      : 'idle'

    setIndexStatus(nextStatus)
    setIndexTotalChunks(state.totalChunks)
    setIndexLastError(state.lastError ?? undefined)

    if (nextStatus !== 'indexing') {
      setIndexProgress(null)
    }
  }, [])

  const refreshIndexState = useCallback(async () => {
    const state = await api.search.getIndexState(projectId).catch(() => null)
    syncIndexState(state)
    return state
  }, [projectId, syncIndexState])

  const handleRequestIndex = useCallback(async () => {
    setIndexStatus('indexing')
    setIndexLastError(undefined)
    try {
      const result = await api.search.reindex(projectId)
      if (result.skipped) {
        setIndexStatus('indexing')
        return
      }

      const state = await refreshIndexState()
      if (!state) {
        setIndexStatus('ready')
      }
    } catch (err) {
      if (isAbortError(err)) {
        await refreshIndexState()
        return
      }

      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to index project:', err)
      setIndexLastError(message)
      setIndexStatus('error')
    }
  }, [projectId, refreshIndexState])

  // Listen for chat open requests from the store (e.g., screenshot -> chat)
  useEffect(() => {
    return chatComposerStore.subscribe(() => {
      if (chatComposerStore.consumeOpenRequest()) {
        setShowChat(true)
      }
    })
  }, [])

  const handleTabChange = useCallback((nextTab: string) => {
    setActiveTab(nextTab)

    if (nextTab === 'Terminal') {
      setHasOpenedTerminal(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const proj = await api.projects.get(projectId)
        if (cancelled) return

        if (!proj) {
          setError(`Project not found: ${projectId}`)
          return
        }

        setProject(proj)
        document.title = `${proj.name} — Pinyino`
        api.projects.updateLastOpened(projectId).catch((err) => {
          console.warn('Failed to update lastOpened:', err)
        })

        await api.search.ensureWatcher(projectId).catch((err) => {
          console.warn('Failed to ensure watcher:', err)
        })

        const state = await refreshIndexState()
        if (cancelled) return

        const indexedRecently =
          state?.status === 'ready' &&
          state.lastFullIndexAt &&
          Date.now() - new Date(state.lastFullIndexAt).getTime() < RECENT_REINDEX_WINDOW_MS

        if (state?.status !== 'indexing' && !indexedRecently) {
          void handleRequestIndex()
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load project:', err)
          setError('Failed to load project')
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [projectId, handleRequestIndex, refreshIndexState])

  useEffect(() => {
    const cleanup = api.search.onIndexProgress((progress) => {
      if (progress.projectId !== projectId) return

      setIndexStatus('indexing')
      setIndexLastError(undefined)
      setIndexProgress(progress)

      if (progress.phase === 'finalizing') {
        void refreshIndexState()
      }
    })

    return cleanup
  }, [projectId, refreshIndexState])

  useEffect(() => {
    if (indexStatus !== 'indexing') return

    let disposed = false

    const poll = async () => {
      const state = await api.search.getIndexState(projectId).catch(() => null)
      if (!disposed) {
        syncIndexState(state)
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, 2000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [projectId, indexStatus, syncIndexState])

  const indexProgressPercent = getProgressPercent(indexProgress)

  if (error) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-error">{error}</p>
          <p className="text-xs text-neutral-600 mt-2">Check the project ID and try again</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">
        <p className="text-xs text-neutral-600">Loading project...</p>
      </div>
    )
  }

  const lazyFallback = (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
    </div>
  )

  function renderActiveView(tab: string, pid: string, onTabChange: (t: string) => void) {
    // Eager-loaded views (default tab + lightweight)
    switch (tab) {
      case 'Tasks':
        return <TasksView projectId={pid} />
      case 'Details':
        return <DashboardView projectId={pid} onTabChange={onTabChange} />
      case 'Notes':
        return <NotesView projectId={pid} />
    }

    // Browser is always mounted but hidden — see persistent render below
    if (tab === 'Browser' || tab === 'Terminal') return null

    // Lazy-loaded views (heavy dependencies)
    return (
      <Suspense fallback={lazyFallback}>
        {tab === 'Sessions' && <SessionsView projectId={pid} />}
        {tab === 'Files' && <FilesView projectId={pid} projectPath={project!.path} />}
        {tab === 'Memory' && <MemoryView projectId={pid} projectPath={project!.path} />}
        {tab === 'Services' && <ServicesView projectId={pid} projectPath={project!.path} />}
        {tab === 'Rules' && <RulesView projectId={pid} projectPath={project!.path} />}
        {tab === 'Git' && <GitView projectId={pid} projectPath={project!.path} />}
        {tab === 'Images' && <ImagesView projectId={pid} />}
        {tab === 'Recordings' && <RecordingsView projectId={pid} />}
        {tab === 'Visualizer' && <VisualizerView projectId={pid} projectPath={project!.path} />}
        {tab === 'Prompt' && <PromptView projectId={pid} />}
        {!['Sessions','Files','Memory','Services','Rules','Git','Images','Recordings','Visualizer','Prompt'].includes(tab) && (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-title text-neutral-300">{tab}</h2>
            <p className="text-sm text-neutral-600 mt-1">Coming soon</p>
          </div>
        )}
      </Suspense>
    )
  }

  function renderContentWithPersistentViews(tab: string) {
    return (
      <>
        {renderActiveView(tab, projectId, handleTabChange)}
        <Suspense fallback={lazyFallback}>
          <div style={{ display: tab === 'Browser' ? 'flex' : 'none' }} className="flex-1 flex-col h-full">
            <BrowserView projectId={projectId} projectPath={project?.path} />
          </div>
        </Suspense>
        {hasOpenedTerminal && (
          <Suspense fallback={lazyFallback}>
            <div style={{ display: tab === 'Terminal' ? 'flex' : 'none' }} className="flex-1 flex-col h-full">
              <TerminalView projectId={projectId} projectPath={project!.path} />
            </div>
          </Suspense>
        )}
      </>
    )
  }

  return (
    <RecordingProvider>
      <div className="h-screen w-screen overflow-hidden bg-neutral-900">
        <div className="flex flex-col h-screen">
          {/* Top bar with project indicators */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
            <button
              onClick={navigateHome}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors"
              title="Back to home"
            >
              <ArrowLeft size={14} />
            </button>
            <img src={logoIcon} alt="Pinyino" className="w-4 h-4" />
            <span className="text-sm font-semibold text-neutral-200 tracking-tight">Pinyino</span>
            <ProjectDropdown />
            <div className="w-px h-4 bg-neutral-700" />
            <ProjectHeaderLeft projectName={project.name} projectPath={project.path} />
            <div className="flex-1" />
            <button
              onClick={() => setShowChat(v => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                showChat
                  ? 'text-codefire-orange bg-codefire-orange/10 hover:bg-codefire-orange/20'
                  : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
              }`}
              title={showChat ? 'Hide Chat' : 'Show Chat'}
            >
              <MessageSquare size={13} />
              <span className="hidden sm:inline">Chat</span>
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <ProjectHeaderRight
              indexStatus={indexStatus}
              indexTotalChunks={indexTotalChunks}
              indexProgress={indexProgress}
              indexLastError={indexLastError}
              onRequestIndex={handleRequestIndex}
              onBriefingClick={() => { setShowBriefing((v) => !v) }}
            />
          </div>

          {/* Tab bar */}
          <TabBar activeTab={activeTab} onTabChange={handleTabChange} />

          {/* Content area */}
          <div className="flex-1 overflow-hidden relative">
            <div
              className="h-full overflow-hidden flex flex-col min-w-0 transition-[padding-right] duration-200"
              style={{ paddingRight: showChat ? 400 : 0 }}
            >
              {renderContentWithPersistentViews(activeTab)}
            </div>

            {/* Chat drawer overlay */}
            {showChat && (
              <div className="absolute right-0 top-0 bottom-0 z-30 border-l border-neutral-800 bg-neutral-900 flex flex-col" style={{ width: 400 }}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
                  <span className="text-xs text-neutral-400 font-medium">Chat</span>
                  <button onClick={() => setShowChat(false)} className="text-neutral-600 hover:text-neutral-300">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <CodeFireChat projectId={projectId} projectName={project!.name} />
                </div>
              </div>
            )}
          </div>

          {/* Briefing Drawer */}
          {showBriefing && (
            <BriefingDrawer projectId={projectId} onClose={() => setShowBriefing(false)} />
          )}

          {/* Status bar */}
          <AgentStatusBar
            projectId={projectId}
            projectPath={project.path}
            indexStatus={indexStatus}
            indexTotalChunks={indexTotalChunks}
            indexProgress={indexProgressPercent}
            indexLastError={indexLastError}
            onRequestIndex={handleRequestIndex}
          />
        </div>

        {/* Global floating record button — visible on all tabs */}
        <FloatingRecordButton projectId={projectId} />
      </div>
    </RecordingProvider>
  )
}
