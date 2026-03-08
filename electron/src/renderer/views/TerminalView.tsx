import TerminalPanel from '@renderer/components/Terminal/TerminalPanel'

interface TerminalViewProps {
  projectId: string
  projectPath: string
}

export default function TerminalView({ projectId, projectPath }: TerminalViewProps) {
  return (
    <div className="h-full flex flex-col">
      <TerminalPanel
        projectId={projectId}
        projectPath={projectPath}
      />
    </div>
  )
}
