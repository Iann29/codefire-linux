import { useState, useEffect, useCallback } from 'react'
import { FolderKanban, Circle } from 'lucide-react'
import type { Project, TaskItem, Client } from '@shared/models'
import { api } from '@renderer/lib/api'

interface ProjectTaskCount {
  project: Project
  client: Client | null
  todoCount: number
  inProgressCount: number
}

export default function ProjectTaskSummary() {
  const [summaries, setSummaries] = useState<ProjectTaskCount[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSummaries = useCallback(async () => {
    try {
      const [projects, clients] = await Promise.all([
        api.projects.list(),
        api.clients.list(),
      ])

      const clientMap = new Map(clients.map((c) => [c.id, c]))

      // Fetch tasks for each project in parallel
      const counts = await Promise.all(
        projects.map(async (project) => {
          const tasks: TaskItem[] = await api.tasks.list(project.id)
          const todoCount = tasks.filter((t) => t.status === 'todo').length
          const inProgressCount = tasks.filter(
            (t) => t.status === 'in_progress'
          ).length
          return {
            project,
            client: project.clientId
              ? clientMap.get(project.clientId) ?? null
              : null,
            todoCount,
            inProgressCount,
          }
        })
      )

      // Only show projects with active tasks, sorted by total desc
      const active = counts
        .filter((c) => c.todoCount + c.inProgressCount > 0)
        .sort(
          (a, b) =>
            b.todoCount +
            b.inProgressCount -
            (a.todoCount + a.inProgressCount)
        )

      setSummaries(active)
    } catch (err) {
      console.error('Failed to fetch project task summaries:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSummaries()
    const interval = setInterval(fetchSummaries, 5000)
    return () => clearInterval(interval)
  }, [fetchSummaries])

  const totalActive = summaries.reduce(
    (sum, s) => sum + s.todoCount + s.inProgressCount,
    0
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
        <FolderKanban size={14} className="text-neutral-400" />
        <span className="text-xs font-medium text-neutral-300">
          Active Tasks by Project
        </span>
        <div className="flex-1" />
        {totalActive > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
            {totalActive}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-neutral-600">Loading...</p>
          </div>
        ) : summaries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-600">
            <FolderKanban size={24} className="mb-2 opacity-40" />
            <p className="text-xs">All clear</p>
            <p className="text-[10px] mt-0.5 opacity-60">
              No active tasks across projects
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {summaries.map((summary) => (
              <button
                key={summary.project.id}
                onClick={() =>
                  api.windows.openProject(summary.project.id)
                }
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/60 transition-colors text-left group"
              >
                {/* Project name */}
                <span className="text-xs text-neutral-300 truncate flex-1">
                  {summary.project.name}
                </span>

                {/* Client badge */}
                {summary.client && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: summary.client.color + '20',
                      color: summary.client.color,
                    }}
                  >
                    {summary.client.name}
                  </span>
                )}

                {/* In Progress count */}
                {summary.inProgressCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-blue-400">
                    <Circle
                      size={6}
                      className="fill-blue-400 text-blue-400"
                    />
                    {summary.inProgressCount}
                  </span>
                )}

                {/* Todo count */}
                <span className="flex items-center gap-0.5 text-[10px] text-codefire-orange">
                  <Circle
                    size={6}
                    className="fill-codefire-orange text-codefire-orange"
                  />
                  {summary.todoCount}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
