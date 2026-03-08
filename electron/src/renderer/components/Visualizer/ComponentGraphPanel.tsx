import { useState, useEffect, useMemo } from 'react'
import { Loader2, Search, FileCode, ArrowRight, ArrowDown } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface ComponentGraphPanelProps {
  projectPath: string
}

interface ComponentNode {
  id: string
  name: string
  filePath: string
  exportName: string
  isDefaultExport: boolean
  framework: string
  importCount: number
  renderCount: number
}

interface ComponentEdge {
  fromFile: string
  toFile: string
  fromName: string
  toName: string
  relation: string
}

interface GraphResult {
  generatedAt: number
  totalComponents: number
  totalEdges: number
  nodes: ComponentNode[]
  edges: ComponentEdge[]
  entryPoints: string[]
}

export default function ComponentGraphPanel({ projectPath }: ComponentGraphPanelProps) {
  const [graph, setGraph] = useState<GraphResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedNode, setSelectedNode] = useState<ComponentNode | null>(null)

  async function analyze() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.componentGraph.analyze(projectPath)
      setGraph(result)
    } catch (err: any) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    analyze()
  }, [projectPath])

  const filteredNodes = useMemo(() => {
    if (!graph) return []
    if (!search) return graph.nodes
    const q = search.toLowerCase()
    return graph.nodes.filter(n =>
      n.name.toLowerCase().includes(q) ||
      n.filePath.toLowerCase().includes(q)
    )
  }, [graph, search])

  const selectedEdges = useMemo(() => {
    if (!graph || !selectedNode) return { incoming: [], outgoing: [], renders: [] }
    return {
      incoming: graph.edges.filter(e => e.toName === selectedNode.name && e.relation === 'imports'),
      outgoing: graph.edges.filter(e => e.fromFile === selectedNode.filePath && e.relation === 'imports'),
      renders: graph.edges.filter(e => e.fromFile === selectedNode.filePath && e.relation === 'renders'),
    }
  }, [graph, selectedNode])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
        <span className="ml-2 text-sm text-neutral-500">Building component graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  if (!graph) return null

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: component list */}
      <div className="w-80 border-r border-neutral-800 flex flex-col shrink-0">
        {/* Search */}
        <div className="px-3 py-2 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2 bg-neutral-800/50 rounded px-2 py-1">
            <Search size={13} className="text-neutral-500 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${graph.totalComponents} components...`}
              className="bg-transparent text-xs text-neutral-200 placeholder-neutral-600 flex-1 outline-none"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="px-3 py-2 border-b border-neutral-800 flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-neutral-500">{graph.totalComponents} components</span>
          <span className="text-[10px] text-neutral-500">{graph.totalEdges} edges</span>
          <button
            onClick={analyze}
            className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors ml-auto"
          >
            Refresh
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredNodes.map(node => (
            <button
              key={node.id}
              onClick={() => setSelectedNode(node)}
              className={`w-full text-left px-3 py-2 border-b border-neutral-800/50 hover:bg-neutral-800/50 transition-colors ${
                selectedNode?.id === node.id ? 'bg-neutral-800' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <FileCode size={13} className="text-blue-400 shrink-0" />
                <span className="text-xs text-neutral-200 font-medium truncate">{node.name}</span>
                {node.isDefaultExport && (
                  <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded shrink-0">default</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 ml-5">
                <span className="text-[10px] text-neutral-600 truncate">{node.filePath}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 ml-5">
                <span className="text-[10px] text-neutral-500">
                  {node.importCount} imports
                </span>
                <span className="text-[10px] text-neutral-500">
                  {node.renderCount} renders
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail panel */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedNode ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileCode size={32} className="text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-500">Select a component to see its relationships</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Component header */}
            <div>
              <h3 className="text-base font-medium text-neutral-200">{selectedNode.name}</h3>
              <p className="text-xs text-neutral-500 mt-0.5">{selectedNode.filePath}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded">
                  {selectedNode.framework}
                </span>
                <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded">
                  {selectedNode.importCount} imported by
                </span>
                <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded">
                  {selectedNode.renderCount} rendered by
                </span>
              </div>
            </div>

            {/* Imported by */}
            {selectedEdges.incoming.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-neutral-400 mb-1.5 flex items-center gap-1">
                  <ArrowDown size={12} /> Imported by ({selectedEdges.incoming.length})
                </h4>
                <div className="space-y-1">
                  {selectedEdges.incoming.map((e, i) => (
                    <div key={i} className="text-xs text-neutral-500 bg-neutral-800/40 rounded px-2 py-1 font-mono truncate">
                      {e.fromFile}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Imports (outgoing) */}
            {selectedEdges.outgoing.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-neutral-400 mb-1.5 flex items-center gap-1">
                  <ArrowRight size={12} /> Imports ({selectedEdges.outgoing.length})
                </h4>
                <div className="space-y-1">
                  {selectedEdges.outgoing.map((e, i) => (
                    <div key={i} className="text-xs text-neutral-500 bg-neutral-800/40 rounded px-2 py-1 font-mono truncate">
                      {e.toName} <span className="text-neutral-600">from {e.toFile}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Renders */}
            {selectedEdges.renders.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-neutral-400 mb-1.5 flex items-center gap-1">
                  <ArrowRight size={12} className="text-green-400" /> Renders ({selectedEdges.renders.length})
                </h4>
                <div className="space-y-1">
                  {selectedEdges.renders.map((e, i) => (
                    <div key={i} className="text-xs text-green-400/80 bg-green-500/5 rounded px-2 py-1 font-mono truncate">
                      {'<'}{e.toName}{' />'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedEdges.incoming.length === 0 && selectedEdges.outgoing.length === 0 && selectedEdges.renders.length === 0 && (
              <p className="text-xs text-neutral-600">No relationships found for this component.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
