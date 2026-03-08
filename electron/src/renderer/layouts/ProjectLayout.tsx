import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Terminal, ArrowLeft } from 'lucide-react'
import type { Project } from '@shared/models'
import { api } from '@renderer/lib/api'
import { useNavigation } from '@renderer/App'
import TerminalPanel from '@renderer/components/Terminal/TerminalPanel'
import TabBar from '@renderer/components/TabBar/TabBar'
import CodeFireChat from '@renderer/components/Chat/CodeFireChat'
import BriefingDrawer from '@renderer/components/Dashboard/BriefingDrawer'
import AgentStatusBar from '@renderer/components/StatusBar/AgentStatusBar'
import { ProjectHeaderLeft, ProjectHeaderRight } from '@renderer/components/Header/ProjectHeaderBar'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
import { usePremium } from '@renderer/hooks/usePremium'
import NotificationBell from '@renderer/components/NotificationBell'
import PresenceAvatars from '@renderer/components/Presence/PresenceAvatars'
import logoIcon from '../../../resources/icon.png'

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
const ActivityView = lazy(() => import('@renderer/views/ActivityView'))
const DocsView = lazy(() => import('@renderer/views/DocsView'))
const ReviewsView = lazy(() => import('@renderer/views/ReviewsView'))

interface ProjectLayoutProps {
  projectId: string
}

export default function ProjectLayout({ projectId }: ProjectLayoutProps) {
  const { navigateHome } = useNavigation()
  const [project, setProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState('Tasks')
  const [error, setError] = useState<string | null>(null)
  const { status: premiumStatus } = usePremium()
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle')
  const [indexLastError, setIndexLastError] = useState<string | undefined>()
  const [showBriefing, setShowBriefing] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showTerminal, setShowTerminal] = useState(true)
  const [terminalOnLeft, setTerminalOnLeft] = useState(false)
  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | 'active' | null>(null)

  // ── Plan 3: Browser Reset On Tab Switch ──
  // Force BrowserView remount with a fresh key whenever the user leaves and returns to Browser
  const [browserKey, setBrowserKey] = useState(0)
  const [prevTab, setPrevTab] = useState(activeTab)
  if (activeTab !== prevTab) {
    // Tab just changed
    if (prevTab === 'Browser') {
      // Leaving Browser → bump key so next visit gets a fresh instance
      setBrowserKey(k => k + 1)
    }
    setPrevTab(activeTab)
  }

  // ── Plan 4: Browser Layout Preset ──
  // Wider content split for Browser tab; key-based remount reapplies defaultSize
  const isBrowserTab = activeTab === 'Browser'
  const contentDefault = isBrowserTab ? '78%' : '60%'
  const sideDefault = isBrowserTab ? '22%' : '40%'
  const layoutKey = `${terminalOnLeft ? 'tl' : 'tr'}-${isBrowserTab ? 'browser' : 'default'}`

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
        document.title = `${proj.name} — CodeFire`
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
        {tab === 'Browser' && <BrowserView key={browserKey} projectId={pid} />}
        {tab === 'Visualizer' && <VisualizerView projectId={pid} projectPath={project!.path} />}
        {tab === 'Activity' && <ActivityView projectId={pid} />}
        {tab === 'Docs' && <DocsView projectId={pid} />}
        {tab === 'Reviews' && <ReviewsView projectId={pid} />}
        {!['Sessions','Files','Memory','Services','Rules','Git','Images','Recordings','Browser','Visualizer','Activity','Docs','Reviews'].includes(tab) && (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-title text-neutral-300">{tab}</h2>
            <p className="text-sm text-neutral-600 mt-1">Coming soon</p>
          </div>
        )}
      </Suspense>
    )
  }

  function renderTerminalChat() {
    const terminalPanel = (
      <TerminalPanel
        projectId={projectId}
        projectPath={project!.path}
        showChat={showChat}
        onToggleChat={() => setShowChat(v => !v)}
        terminalOnLeft={terminalOnLeft}
        onSwapPanels={() => setTerminalOnLeft(v => !v)}
      />
    )

    if (!showChat) return terminalPanel

    return (
      <Group orientation="vertical" id="terminal-chat-split">
        <Panel id="terminal" defaultSize="50%" minSize="15%">
          {terminalPanel}
        </Panel>
        <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
        <Panel id="chat" defaultSize="50%" minSize="15%">
          <CodeFireChat projectId={projectId} projectName={project!.name} />
        </Panel>
      </Group>
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
          <img src={logoIcon} alt="CodeFire" className="w-4 h-4" />
          <span className="text-sm font-semibold text-neutral-200 tracking-tight">CodeFire</span>
          <ProjectDropdown />
          <div className="w-px h-4 bg-neutral-700" />
          <ProjectHeaderLeft projectName={project.name} projectPath={project.path} />
          <div className="flex-1" />
          {premiumStatus?.enabled && premiumStatus.authenticated && (
            <PresenceAvatars projectId={projectId} />
          )}
          <button
            onClick={() => setShowTerminal(v => !v)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              showTerminal
                ? 'text-codefire-orange bg-codefire-orange/10 hover:bg-codefire-orange/20'
                : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
            }`}
            title={showTerminal ? 'Hide Terminal' : 'Show Terminal'}
          >
            <Terminal size={13} />
            <span className="hidden sm:inline">Terminal</span>
          </button>
          <NotificationBell />
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

        {/* Content: view + terminal/chat columns (swappable via drag) */}
        <div
          className="flex-1 overflow-hidden relative"
          onDragOver={(e) => {
            // Activate drop zones when a panel drag is in progress
            if (e.dataTransfer.types.includes('application/x-codefire-panel')) {
              e.preventDefault()
              if (dragOverSide === null) setDragOverSide('active')
            }
          }}
          onDragLeave={(e) => {
            // Only clear if leaving the container entirely
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverSide(null)
            }
          }}
          onDrop={() => setDragOverSide(null)}
        >
          {showTerminal ? (
            <Group orientation="horizontal" id="project-layout" key={layoutKey}>
              {terminalOnLeft ? (
                <>
                  <Panel id="terminal-chat" defaultSize={sideDefault} minSize="20%">
                    {renderTerminalChat()}
                  </Panel>
                  <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
                  <Panel id="content" defaultSize={contentDefault} minSize="30%">
                    <div className="h-full overflow-hidden flex flex-col">
                      {renderActiveView(activeTab, projectId, setActiveTab)}
                    </div>
                  </Panel>
                </>
              ) : (
                <>
                  <Panel id="content" defaultSize={contentDefault} minSize="30%">
                    <div className="h-full overflow-hidden flex flex-col">
                      {renderActiveView(activeTab, projectId, setActiveTab)}
                    </div>
                  </Panel>
                  <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
                  <Panel id="terminal-chat" defaultSize={sideDefault} minSize="20%">
                    {renderTerminalChat()}
                  </Panel>
                </>
              )}
            </Group>
          ) : (
            <div className="h-full overflow-hidden flex flex-col">
              {renderActiveView(activeTab, projectId, setActiveTab)}
            </div>
          )}

          {/* Drop zones — full-height overlays on left/right edges, visible during drag */}
          {dragOverSide !== null && (
            <>
              <div
                className={`absolute inset-y-0 left-0 w-1/2 z-40 transition-colors duration-100 ${
                  dragOverSide === 'left'
                    ? 'bg-codefire-orange/10 border-l-4 border-codefire-orange/40'
                    : 'bg-transparent'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverSide('left')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSide(null)
                  if (!terminalOnLeft) setTerminalOnLeft(true)
                }}
              />
              <div
                className={`absolute inset-y-0 right-0 w-1/2 z-40 transition-colors duration-100 ${
                  dragOverSide === 'right'
                    ? 'bg-codefire-orange/10 border-r-4 border-codefire-orange/40'
                    : 'bg-transparent'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverSide('right')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSide(null)
                  if (terminalOnLeft) setTerminalOnLeft(false)
                }}
              />
            </>
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
