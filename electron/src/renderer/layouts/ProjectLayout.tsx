import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { MessageSquare, ArrowLeft, X } from 'lucide-react'
import type { Project } from '@shared/models'
import { api } from '@renderer/lib/api'
import { useNavigation } from '@renderer/App'
import TabBar from '@renderer/components/TabBar/TabBar'
import CodeFireChat from '@renderer/components/Chat/CodeFireChat'
import BriefingDrawer from '@renderer/components/Dashboard/BriefingDrawer'
import AgentStatusBar from '@renderer/components/StatusBar/AgentStatusBar'
import { ProjectHeaderLeft, ProjectHeaderRight } from '@renderer/components/Header/ProjectHeaderBar'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
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

interface ProjectLayoutProps {
  projectId: string
}

export default function ProjectLayout({ projectId }: ProjectLayoutProps) {
  const { navigateHome } = useNavigation()
  const [project, setProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState('Tasks')
  const [error, setError] = useState<string | null>(null)
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle')
  const [indexLastError, setIndexLastError] = useState<string | undefined>()
  const [showBriefing, setShowBriefing] = useState(false)
  const [showChat, setShowChat] = useState(false)

  const handleRequestIndex = useCallback(async () => {
    setIndexStatus('indexing')
    setIndexLastError(undefined)
    try {
      await api.search.reindex(projectId)
      setIndexStatus('ready')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to index project:', err)
      setIndexLastError(message)
      setIndexStatus('error')
    }
  }, [projectId])

  // Listen for chat open requests from the store (e.g., screenshot -> chat)
  useEffect(() => {
    return chatComposerStore.subscribe(() => {
      if (chatComposerStore.consumeOpenRequest()) {
        setShowChat(true)
      }
    })
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

        // Always trigger indexing when a project is opened
        handleRequestIndex()
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
  }, [projectId, handleRequestIndex])

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
    if (tab === 'Browser') return null

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
        {tab === 'Terminal' && <TerminalView projectId={pid} projectPath={project!.path} />}
        {tab === 'Visualizer' && <VisualizerView projectId={pid} projectPath={project!.path} />}
        {!['Sessions','Files','Memory','Services','Rules','Git','Images','Recordings','Terminal','Visualizer'].includes(tab) && (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-title text-neutral-300">{tab}</h2>
            <p className="text-sm text-neutral-600 mt-1">Coming soon</p>
          </div>
        )}
      </Suspense>
    )
  }

  function renderContentWithPersistentBrowser(tab: string) {
    return (
      <>
        {renderActiveView(tab, projectId, setActiveTab)}
        <Suspense fallback={lazyFallback}>
          <div style={{ display: tab === 'Browser' ? 'flex' : 'none' }} className="flex-1 flex-col h-full">
            <BrowserView projectId={projectId} />
          </div>
        </Suspense>
      </>
    )
  }

  return (
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
            indexLastError={indexLastError}
            onRequestIndex={handleRequestIndex}
            onBriefingClick={() => { setShowBriefing((v) => !v) }}
          />
        </div>

        {/* Tab bar */}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Content area */}
        <div className="flex-1 overflow-hidden relative">
          <div className="h-full overflow-hidden flex flex-col">
            {renderContentWithPersistentBrowser(activeTab)}
          </div>

          {/* Chat drawer overlay */}
          {showChat && (
            <div className="absolute right-0 top-0 bottom-0 w-[400px] z-30 border-l border-neutral-800 bg-neutral-900 flex flex-col">
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
          indexLastError={indexLastError}
          onRequestIndex={handleRequestIndex}
        />
      </div>
    </div>
  )
}
