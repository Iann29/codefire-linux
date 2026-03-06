import { useState, useEffect, useCallback } from 'react'
import type { ProjectDoc } from '@shared/premium-models'
import { api } from '@renderer/lib/api'

export function useProjectDocs(projectId: string) {
  const [docs, setDocs] = useState<ProjectDoc[]>([])
  const [selectedDoc, setSelectedDoc] = useState<ProjectDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDocs = useCallback(async () => {
    try {
      setError(null)
      const data = await api.premium.listProjectDocs(projectId)
      setDocs(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load docs')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    fetchDocs()
  }, [fetchDocs])

  const selectDoc = useCallback(async (docId: string) => {
    const doc = docs.find(d => d.id === docId)
    if (doc) {
      setSelectedDoc(doc)
      return
    }
    // Fetch from server if not in local list
    try {
      const fetched = await api.premium.getProjectDoc(docId)
      if (fetched) setSelectedDoc(fetched)
    } catch {
      // ignore
    }
  }, [docs])

  const createDoc = useCallback(async (title: string, content: string = '') => {
    const doc = await api.premium.createProjectDoc({ projectId, title, content })
    await fetchDocs()
    setSelectedDoc(doc)
    return doc
  }, [projectId, fetchDocs])

  const updateDoc = useCallback(async (docId: string, data: { title?: string; content?: string }) => {
    const updated = await api.premium.updateProjectDoc(docId, data)
    await fetchDocs()
    if (selectedDoc?.id === docId) {
      setSelectedDoc(updated)
    }
    return updated
  }, [fetchDocs, selectedDoc])

  const deleteDoc = useCallback(async (docId: string) => {
    await api.premium.deleteProjectDoc(docId)
    if (selectedDoc?.id === docId) {
      setSelectedDoc(null)
    }
    await fetchDocs()
  }, [fetchDocs, selectedDoc])

  return {
    docs,
    selectedDoc,
    selectDoc,
    createDoc,
    updateDoc,
    deleteDoc,
    loading,
    error,
    refresh: fetchDocs,
  }
}
