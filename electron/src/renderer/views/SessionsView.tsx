import { useState, useEffect } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useSessions } from '@renderer/hooks/useSessions'
import { api } from '@renderer/lib/api'
import type { Session } from '@shared/models'
import SessionList from '@renderer/components/Sessions/SessionList'
import SessionDetail from '@renderer/components/Sessions/SessionDetail'

interface SessionsViewProps {
  projectId: string
}

export default function SessionsView({ projectId }: SessionsViewProps) {
  const { sessions, loading, error } = useSessions(projectId)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Session[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [activeSession, setActiveSession] = useState<{ sessionId: string; lastActivity: string } | null>(null)

  useEffect(() => {
    api.sessions.findActive(projectId).then(setActiveSession)
    const interval = setInterval(() => {
      api.sessions.findActive(projectId).then(setActiveSession)
    }, 10000)
    return () => clearInterval(interval)
  }, [projectId])

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const results = await api.sessions.search(query)
      // Filter to only sessions for this project
      const filtered = results.filter((s) => s.projectId === projectId)
      setSearchResults(filtered)
    } catch {
      setSearchResults(null)
    } finally {
      setSearching(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-error">{error}</p>
      </div>
    )
  }

  const displaySessions = searchResults ?? sessions

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-neutral-800 shrink-0">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            className="w-full bg-neutral-800 border border-neutral-700 rounded-cf pl-7 pr-2 py-1.5
                       text-sm text-neutral-200 placeholder-neutral-500
                       focus:outline-none focus:border-codefire-orange/50"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {searching && (
            <Loader2
              size={14}
              className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-neutral-500"
            />
          )}
        </div>
      </div>

      {/* Active session indicator */}
      {activeSession && (
        <div className="px-3 py-2 border-b border-neutral-800 bg-green-950/20 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 font-medium">Active Session</span>
            <span className="text-neutral-500 truncate">{activeSession.sessionId.slice(0, 8)}...</span>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Session list panel */}
        <div className="w-72 border-r border-neutral-800 shrink-0">
          <SessionList
            sessions={displaySessions}
            selectedId={selectedSession?.id ?? null}
            onSelect={setSelectedSession}
          />
        </div>

        {/* Session detail panel */}
        <div className="flex-1">
          <SessionDetail session={selectedSession} />
        </div>
      </div>
    </div>
  )
}
