import { useState, useEffect, useCallback, useMemo } from 'react'
import type { TaskItem, TaskNote } from '@shared/models'
import { api } from '@renderer/lib/api'

export function useTasks(projectId: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.tasks.list(projectId)
      setTasks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const createTask = useCallback(
    async (title: string, status?: string) => {
      const task = await api.tasks.create({ projectId, title })
      if (status && status !== 'todo') {
        await api.tasks.update(task.id, { status })
      }
      // Optimistic: append new task locally
      setTasks((prev) => [
        ...prev,
        { ...task, status: status || 'todo' } as TaskItem,
      ])
      return task
    },
    [projectId]
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
      // Optimistic update — apply changes immediately
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          const updated = { ...t, ...data }
          if (data.labels) {
            updated.labels = JSON.stringify(data.labels) as unknown as string
          }
          return updated as TaskItem
        })
      )
      try {
        await api.tasks.update(id, data)
      } catch {
        // Rollback on failure
        await fetchTasks()
      }
    },
    [fetchTasks]
  )

  const deleteTask = useCallback(
    async (id: number) => {
      // Optimistic: remove immediately
      setTasks((prev) => prev.filter((t) => t.id !== id))
      try {
        await api.tasks.delete(id)
      } catch {
        // Rollback on failure
        await fetchTasks()
      }
    },
    [fetchTasks]
  )

  // Memoize grouped tasks to avoid new arrays every render
  const todoTasks = useMemo(() => tasks.filter((t) => t.status === 'todo'), [tasks])
  const inProgressTasks = useMemo(() => tasks.filter((t) => t.status === 'in_progress'), [tasks])
  const doneTasks = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks])

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

export function useTaskNotes(taskId: number | null) {
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [loading, setLoading] = useState(false)

  const fetchNotes = useCallback(async () => {
    if (taskId === null) {
      setNotes([])
      return
    }
    setLoading(true)
    try {
      const data = await api.taskNotes.list(taskId)
      setNotes(data)
    } catch {
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const addNote = useCallback(
    async (content: string) => {
      if (taskId === null) return
      await api.taskNotes.create({ taskId, content, source: 'manual' })
      await fetchNotes()
    },
    [taskId, fetchNotes]
  )

  return { notes, loading, addNote, refetch: fetchNotes }
}
