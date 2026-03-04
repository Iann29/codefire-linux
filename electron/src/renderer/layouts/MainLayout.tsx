import { Group, Panel, Separator } from 'react-resizable-panels'
import Sidebar from '@renderer/components/Sidebar/Sidebar'
import HomeView from '@renderer/views/HomeView'

export default function MainLayout() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900">
      {/* Drag region for frameless window title bar */}
      <div className="drag-region h-7 flex-shrink-0" />

      <div className="flex flex-col" style={{ height: 'calc(100vh - 28px)' }}>
        <Group orientation="horizontal" id="main-layout">
          {/* Sidebar panel */}
          <Panel id="sidebar" defaultSize="18%" minSize="12%" maxSize="25%">
            <Sidebar />
          </Panel>

          {/* Resize handle */}
          <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

          {/* Home/Planner content area */}
          <Panel id="home">
            <HomeView />
          </Panel>
        </Group>
      </div>
    </div>
  )
}
