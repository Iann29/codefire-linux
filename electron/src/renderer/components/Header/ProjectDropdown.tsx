import { useState, useEffect, useCallback, useRef } from 'react'
import { Folder, FolderOpen, Settings, Plus, ChevronDown, ChevronRight, Check, X, Search } from 'lucide-react'
import type { Project, Client } from '@shared/models'
import { api } from '@renderer/lib/api'
import { useNavigation } from '@renderer/App'
import SettingsModal from '@renderer/components/Settings/SettingsModal'

function displayName(project: Project): string {
  const name = project.name
  if (name.includes('/') || name.includes('\\')) {
    const segments = name.split(/[/\\]/).filter(Boolean)
    return segments[segments.length - 1] ?? name
  }
  return name
}

export default function ProjectDropdown() {
  const { navigateToProject } = useNavigation()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#F97316')
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const addGroupInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [projectList, clientList] = await Promise.all([
        api.projects.list(),
        api.clients.list(),
      ])
      setProjects(projectList)
      setClients(clientList)
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Reload when dropdown opens and reset search
  useEffect(() => {
    if (open) {
      load()
      setSearchQuery('')
      setHighlightedIndex(0)
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [open, load])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open) return
    const el = dropdownRef.current?.querySelector('[data-highlighted="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowAddGroup(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setShowAddGroup(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const displayProjects = projects.filter((p) => p.id !== '__global__')

  const filteredProjects = searchQuery
    ? displayProjects.filter((p) => displayName(p).toLowerCase().includes(searchQuery.toLowerCase()))
    : displayProjects

  const clientProjectMap = new Map<string, Project[]>()
  const ungrouped: Project[] = []
  for (const project of filteredProjects) {
    if (project.clientId) {
      const list = clientProjectMap.get(project.clientId) ?? []
      list.push(project)
      clientProjectMap.set(project.clientId, list)
    } else {
      ungrouped.push(project)
    }
  }

  // Flat list of navigable projects in render order (for keyboard nav)
  const navigableProjects: Project[] = []
  for (const client of clients) {
    const cp = clientProjectMap.get(client.id) ?? []
    if (cp.length > 0 && (expandedClients.has(client.id) || !!searchQuery)) {
      navigableProjects.push(...cp)
    }
  }
  navigableProjects.push(...ungrouped)
  const highlightedProjectId = navigableProjects[highlightedIndex]?.id

  const toggleClient = (clientId: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const handleOpenProject = (projectId: string) => {
    navigateToProject(projectId)
    setOpen(false)
  }

  async function handleOpenFolder() {
    try {
      const folderPath = await api.dialog.selectFolder()
      if (!folderPath) return
      const existing = await api.projects.getByPath(folderPath)
      if (!existing) {
        const sep = folderPath.includes('\\') ? '\\' : '/'
        const name = folderPath.split(sep).filter(Boolean).pop() ?? folderPath
        await api.projects.create({ name, path: folderPath })
      }
    } catch (err) {
      console.error('Failed to open folder:', err)
    }
    await load()
  }

  function handleAddGroup() {
    setShowAddGroup(true)
    setNewGroupName('')
    setNewGroupColor('#F97316')
    setTimeout(() => addGroupInputRef.current?.focus(), 50)
  }

  async function handleAddGroupSubmit() {
    if (!newGroupName.trim()) return
    await api.clients.create({ name: newGroupName.trim(), color: newGroupColor })
    setShowAddGroup(false)
    setNewGroupName('')
    load()
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
        title="Open a project"
      >
        <Folder size={14} className="text-codefire-orange" />
        <span className="text-sm font-semibold text-neutral-200 max-w-48 truncate">All projects</span>
        <ChevronDown size={12} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 overflow-hidden">
          {/* Search input */}
          <div className="px-2 pt-2 pb-1">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setHighlightedIndex(0) }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchQuery) {
                    e.stopPropagation()
                    setSearchQuery('')
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    if (navigableProjects.length > 0) {
                      setHighlightedIndex((i) => Math.min(i + 1, navigableProjects.length - 1))
                    }
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    if (navigableProjects.length > 0) {
                      setHighlightedIndex((i) => Math.max(i - 1, 0))
                    }
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (navigableProjects[highlightedIndex]) {
                      handleOpenProject(navigableProjects[highlightedIndex].id)
                    }
                  }
                }}
                placeholder="Search projects..."
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 pl-7 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setHighlightedIndex(0); searchInputRef.current?.focus() }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-neutral-500 hover:text-neutral-300"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
          {/* Scrollable project list */}
          <div className="max-h-80 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-neutral-600">Loading...</p>
              </div>
            ) : (
              <>
                {/* Client groups */}
                {clients.map((client) => {
                  const clientProjects = clientProjectMap.get(client.id) ?? []
                  if (clientProjects.length === 0) return null
                  const isExpanded = expandedClients.has(client.id) || !!searchQuery
                  return (
                    <div key={client.id}>
                      <button
                        onClick={() => toggleClient(client.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: client.color || '#737373' }}
                        />
                        <span className="truncate font-semibold uppercase tracking-wider">{client.name}</span>
                        <span className="ml-auto text-neutral-600">
                          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        </span>
                      </button>
                      {isExpanded && clientProjects.map((project) => (
                        <button
                          key={project.id}
                          onClick={() => handleOpenProject(project.id)}
                          onMouseEnter={() => { const idx = navigableProjects.findIndex((p) => p.id === project.id); if (idx >= 0) setHighlightedIndex(idx) }}
                          data-highlighted={project.id === highlightedProjectId ? 'true' : undefined}
                          className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] transition-colors ${project.id === highlightedProjectId ? 'bg-white/[0.08] text-neutral-200' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}`}
                        >
                          <Folder size={12} className="flex-shrink-0 text-neutral-600" />
                          <span className="truncate">{displayName(project)}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}

                {/* Ungrouped projects */}
                {ungrouped.length > 0 && (
                  <>
                    {clients.length > 0 && (
                      <div className="px-3 py-1 mt-1">
                        <span className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">Projects</span>
                      </div>
                    )}
                    {ungrouped.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => handleOpenProject(project.id)}
                        onMouseEnter={() => { const idx = navigableProjects.findIndex((p) => p.id === project.id); if (idx >= 0) setHighlightedIndex(idx) }}
                        data-highlighted={project.id === highlightedProjectId ? 'true' : undefined}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${project.id === highlightedProjectId ? 'bg-white/[0.08] text-neutral-200' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}`}
                      >
                        <Folder size={12} className="flex-shrink-0 text-neutral-600" />
                        <span className="truncate">{displayName(project)}</span>
                      </button>
                    ))}
                  </>
                )}

                {displayProjects.length === 0 && (
                  <div className="px-3 py-4 text-center">
                    <p className="text-xs text-neutral-600">No projects yet</p>
                  </div>
                )}
                {displayProjects.length > 0 && filteredProjects.length === 0 && (
                  <div className="px-3 py-4 text-center">
                    <p className="text-xs text-neutral-600">No projects found</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mx-2 border-t border-neutral-800" />

          {/* Add Group inline form */}
          {showAddGroup && (
            <div className="px-3 py-2 space-y-2 border-b border-neutral-800">
              <div className="flex items-center gap-1.5">
                <input
                  ref={addGroupInputRef}
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddGroupSubmit()
                    if (e.key === 'Escape') setShowAddGroup(false)
                  }}
                  placeholder="Group name..."
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange"
                />
                <button
                  onClick={handleAddGroupSubmit}
                  disabled={!newGroupName.trim()}
                  className="p-1 rounded text-green-400 hover:bg-green-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setShowAddGroup(false)}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-300"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {['#F97316', '#3B82F6', '#10B981', '#A855F7', '#EF4444', '#F59E0B'].map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewGroupColor(color)}
                    className={`w-4 h-4 rounded-full transition-all ${newGroupColor === color ? 'ring-2 ring-offset-1 ring-offset-neutral-900 ring-white scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Bottom actions */}
          <div className="flex items-center gap-1 px-2 py-1.5">
            <button
              onClick={() => { setShowSettings(true); setOpen(false) }}
              className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
              title="Settings"
            >
              <Settings size={13} />
            </button>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
              title="Open project folder"
            >
              <FolderOpen size={12} />
              <span>Open Folder</span>
            </button>
            <div className="flex-1" />
            <button
              onClick={handleAddGroup}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
              title="Add client group"
            >
              <Plus size={11} />
              <span>Group</span>
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
