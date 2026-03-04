import { useState, useEffect, useCallback } from 'react'
import type { TaskItem } from '@shared/models'
import { api } from '@renderer/lib/api'

export function useGlobalTasks() {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.tasks.listGlobal()
      setTasks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const createTask = useCallback(
    async (title: string, status?: string) => {
      const task = await api.tasks.create({
        projectId: '__global__',
        title,
        isGlobal: true,
      })
      if (status && status !== 'todo') {
        await api.tasks.update(task.id, { status })
      }
      await fetchTasks()
      return task
    },
    [fetchTasks]
  )

  const updateTask = useCallback(
    async (
      id: number,
      data: {
        title?: string
        description?: string
        status?: string
        priority?: number
        labels?: string[]
      }
    ) => {
      await api.tasks.update(id, data)
      await fetchTasks()
    },
    [fetchTasks]
  )

  const deleteTask = useCallback(
    async (id: number) => {
      await api.tasks.delete(id)
      await fetchTasks()
    },
    [fetchTasks]
  )

  const todoTasks = tasks.filter((t) => t.status === 'todo')
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress')
  const doneTasks = tasks.filter((t) => t.status === 'done')

  return {
    tasks,
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    refetch: fetchTasks,
  }
}
