import { Group, Panel, Separator } from 'react-resizable-panels'
import { useGlobalTasks } from '@renderer/hooks/useGlobalTasks'
import KanbanBoard from '@renderer/components/Kanban/KanbanBoard'
import ProjectTaskSummary from '@renderer/components/Home/ProjectTaskSummary'
import { ListTodo } from 'lucide-react'

export default function HomeView() {
  const {
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
  } = useGlobalTasks()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-neutral-600">Loading planner...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-error">{error}</p>
      </div>
    )
  }

  const openCount =
    todoTasks.length + inProgressTasks.length

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800 shrink-0">
        <ListTodo size={16} className="text-codefire-orange" />
        <h1 className="text-sm font-semibold text-neutral-200">Planner</h1>
        <div className="flex-1" />
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
          {openCount} open
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-500">
          {doneTasks.length} done
        </span>
      </div>

      {/* Vertical split: Kanban on top, project summary on bottom */}
      <div className="flex-1 overflow-hidden">
        <Group orientation="vertical" id="home-layout">
          {/* Top: Global Kanban Board */}
          <Panel id="kanban" defaultSize="65%" minSize="30%">
            <div className="h-full overflow-hidden">
              <KanbanBoard
                todoTasks={todoTasks}
                inProgressTasks={inProgressTasks}
                doneTasks={doneTasks}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onAddTask={createTask}
              />
            </div>
          </Panel>

          <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

          {/* Bottom: Project Task Summary */}
          <Panel id="project-summary" defaultSize="35%" minSize="15%">
            <ProjectTaskSummary />
          </Panel>
        </Group>
      </div>
    </div>
  )
}
