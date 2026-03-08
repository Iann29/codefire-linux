import { useState, useEffect, lazy, Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import logoIcon from '../../../resources/icon.png'
import { api } from '@renderer/lib/api'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
import AllProjectsView from '@renderer/views/AllProjectsView'
import NotificationBell from '@renderer/components/NotificationBell'

const TerminalPanel = lazy(() => import('@renderer/components/Terminal/TerminalPanel'))
const CodeFireChat = lazy(() => import('@renderer/components/Chat/CodeFireChat'))

export default function MainLayout() {
  const [defaultTerminalPath, setDefaultTerminalPath] = useState('')

  useEffect(() => {
    document.title = 'CodeFire'
    api.settings.get().then((cfg) => {
      if (cfg.defaultTerminalPath) setDefaultTerminalPath(cfg.defaultTerminalPath)
    }).catch(() => {})
  }, [])

  const terminalProjectPath = defaultTerminalPath || window.api.homePath

  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900">
      <div className="flex flex-col h-screen">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-950 shrink-0">
          <img src={logoIcon} alt="CodeFire" className="w-4 h-4" />
          <span className="text-sm font-semibold text-neutral-200 tracking-tight">CodeFire</span>

          <ProjectDropdown />

          <div className="flex-1" />

          <NotificationBell />
        </div>

        {/* Main content area: dashboard left + terminal/chat right */}
        <div className="flex-1 overflow-hidden">
          <Group orientation="horizontal" id="main-layout">
            <Panel id="content" defaultSize="60%" minSize="30%">
              <AllProjectsView />
            </Panel>

            <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

            {/* Right panel: Terminal (top) + CodeFire Chat (bottom) */}
            <Panel id="terminal-chat" defaultSize="40%" minSize="20%">
              <Group orientation="vertical" id="main-terminal-chat-split">
                <Panel id="terminal" defaultSize="50%" minSize="15%">
                  <Suspense fallback={<div className="h-full bg-neutral-900" />}>
                    <TerminalPanel key="__global__" projectId="__global__" projectPath={terminalProjectPath} />
                  </Suspense>
                </Panel>

                <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

                <Panel id="chat" defaultSize="50%" minSize="15%">
                  <Suspense fallback={<div className="h-full bg-neutral-900" />}>
                    <CodeFireChat />
                  </Suspense>
                </Panel>
              </Group>
            </Panel>
          </Group>
        </div>

        {/* Status bar */}
        <div className="w-full h-7 flex-shrink-0 flex items-center justify-end px-3 bg-neutral-950 border-t border-neutral-800 no-drag">
          <span className="text-tiny text-neutral-700 font-mono flex-shrink-0">
            v{__APP_VERSION__}
          </span>
        </div>
      </div>

    </div>
  )
}
