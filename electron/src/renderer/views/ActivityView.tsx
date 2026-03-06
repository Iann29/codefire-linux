import { useState } from 'react'
import { Activity, CheckCircle, FileText, Users, GitBranch, Clock, RefreshCw, MessageSquare } from 'lucide-react'
import { useActivityFeed } from '@renderer/hooks/useActivityFeed'
import { useSessionSummaries } from '@renderer/hooks/useSessionSummaries'
import SharedSummaryCard from '@renderer/components/SessionSummary/SharedSummaryCard'
import type { ActivityEvent } from '@shared/premium-models'

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'task_created':
    case 'task_updated':
      return <Activity size={14} className="text-blue-400" />
    case 'task_completed':
      return <CheckCircle size={14} className="text-green-400" />
    case 'note_created':
    case 'note_updated':
      return <FileText size={14} className="text-amber-400" />
    case 'member_joined':
    case 'member_left':
      return <Users size={14} className="text-purple-400" />
    case 'project_synced':
      return <GitBranch size={14} className="text-codefire-orange" />
    case 'session_shared':
      return <Clock size={14} className="text-cyan-400" />
    default:
      return <Activity size={14} className="text-neutral-500" />
  }
}

function getEventDescription(event: ActivityEvent): string {
  const meta = event.metadata as Record<string, string | undefined>

  switch (event.eventType) {
    case 'task_created':
      return `created task${meta.title ? ` "${meta.title}"` : ''}`
    case 'task_updated':
      return `updated task${meta.title ? ` "${meta.title}"` : ''}`
    case 'task_completed':
      return `completed task${meta.title ? ` "${meta.title}"` : ''}`
    case 'note_created':
      return `created note${meta.title ? ` "${meta.title}"` : ''}`
    case 'note_updated':
      return `updated note${meta.title ? ` "${meta.title}"` : ''}`
    case 'member_joined':
      return 'joined the project'
    case 'member_left':
      return 'left the project'
    case 'project_synced':
      return 'synced the project'
    case 'session_shared':
      return `shared a session${meta.summary ? `: ${meta.summary}` : ''}`
    default:
      return event.eventType.replace(/_/g, ' ')
  }
}

function UserAvatar({ user }: { user?: ActivityEvent['user'] }) {
  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName || user.email}
        className="w-7 h-7 rounded-full object-cover"
      />
    )
  }

  const initials = user?.displayName
    ? user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?'

  return (
    <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-[10px] font-medium text-neutral-300">
      {initials}
    </div>
  )
}

interface ActivityViewProps {
  projectId: string
}

type Tab = 'activity' | 'summaries'

export default function ActivityView({ projectId }: ActivityViewProps) {
  const [tab, setTab] = useState<Tab>('activity')
  const { events, loading: eventsLoading, error: eventsError, refresh: refreshEvents } = useActivityFeed(projectId)
  const { summaries, loading: summariesLoading, error: summariesError, refresh: refreshSummaries } = useSessionSummaries(projectId)

  const loading = tab === 'activity' ? eventsLoading : summariesLoading
  const error = tab === 'activity' ? eventsError : summariesError
  const isEmpty = tab === 'activity' ? events.length === 0 : summaries.length === 0
  const refresh = tab === 'activity' ? refreshEvents : refreshSummaries

  if (loading && isEmpty) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
      </div>
    )
  }

  if (error && isEmpty) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTab('activity')}
            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
              tab === 'activity' ? 'text-neutral-200' : 'text-neutral-500 hover:text-neutral-400'
            }`}
          >
            <Activity size={14} />
            Activity
            <span className="text-[10px] text-neutral-600">{events.length}</span>
          </button>
          <button
            onClick={() => setTab('summaries')}
            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
              tab === 'summaries' ? 'text-neutral-200' : 'text-neutral-500 hover:text-neutral-400'
            }`}
          >
            <MessageSquare size={14} />
            Summaries
            <span className="text-[10px] text-neutral-600">{summaries.length}</span>
          </button>
        </div>
        <button
          onClick={refresh}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'activity' ? (
          /* Activity event list */
          events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <Activity size={28} className="text-neutral-700 mb-3" />
              <p className="text-xs text-neutral-500">No activity yet</p>
              <p className="text-[10px] text-neutral-600 mt-1">
                Activity from team members will appear here
              </p>
            </div>
          ) : (
            <div className="px-4 py-2">
              {events.map((event, index) => (
                <div key={event.id} className="relative flex gap-3 pb-4">
                  {/* Timeline line */}
                  {index < events.length - 1 && (
                    <div className="absolute left-[13px] top-8 bottom-0 w-px bg-neutral-800" />
                  )}

                  {/* Avatar */}
                  <div className="shrink-0 z-10">
                    <UserAvatar user={event.user} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-neutral-200">
                        {event.user?.displayName || event.user?.email || 'Unknown'}
                      </span>
                      {getEventIcon(event.eventType)}
                      <span className="text-xs text-neutral-400 truncate">
                        {getEventDescription(event)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-neutral-600">
                        {formatRelativeTime(event.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* Session summaries list */
          summaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <MessageSquare size={28} className="text-neutral-700 mb-3" />
              <p className="text-xs text-neutral-500">No shared summaries yet</p>
              <p className="text-[10px] text-neutral-600 mt-1">
                Session summaries shared by team members will appear here
              </p>
            </div>
          ) : (
            <div className="px-4 py-2 flex flex-col gap-2">
              {summaries.map((summary) => (
                <SharedSummaryCard key={summary.id} summary={summary} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
