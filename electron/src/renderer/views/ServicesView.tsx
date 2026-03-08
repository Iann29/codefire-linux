import { useState, useEffect } from 'react'
import { Cloud, KeyRound, FileText, Loader2, Stethoscope, Globe, Shield } from 'lucide-react'
import { api } from '@renderer/lib/api'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'
import ServiceCard from '@renderer/components/Services/ServiceCard'
import EnvFilePanel from '@renderer/components/Services/EnvFilePanel'
import EnvDoctorPanel from '@renderer/components/Services/EnvDoctorPanel'
import PreviewEnvironmentsPanel from '@renderer/components/Services/PreviewEnvironmentsPanel'
import LaunchGuardPanel from '@renderer/components/Services/LaunchGuardPanel'

interface ServicesViewProps {
  projectId: string
  projectPath: string
}

interface Service {
  name: string
  configFile: string
  configPath: string
  dashboardUrl: string | null
  icon: string
}

interface EnvFile {
  name: string
  path: string
  varCount: number
}

interface Template {
  name: string
  path: string
  vars: Array<{ key: string; comment?: string; defaultValue?: string }>
}

export default function ServicesView({ projectPath }: ServicesViewProps) {
  const [services, setServices] = useState<Service[]>([])
  const [envFiles, setEnvFiles] = useState<EnvFile[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [svc, env, tpl] = await Promise.all([
          api.services.detect(projectPath),
          api.services.listEnvFiles(projectPath),
          api.services.scanTemplates(projectPath),
        ])
        if (cancelled) return
        setServices(svc)
        setEnvFiles(env)
        setTemplates(tpl)
      } catch (err) {
        console.error('Failed to load services data:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Services */}
      {services.length > 0 && (
        <CollapsibleSection
          title="Services"
          count={services.length}
          icon={<Cloud size={14} className="text-blue-400" />}
        >
          <div className="space-y-2">
            {services.map((svc) => (
              <ServiceCard
                key={svc.configPath}
                name={svc.name}
                configFile={svc.configFile}
                dashboardUrl={svc.dashboardUrl}
                icon={svc.icon}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Preview Environments */}
      <CollapsibleSection
        title="Preview Environments"
        icon={<Globe size={14} className="text-cyan-400" />}
        defaultOpen={false}
      >
        <PreviewEnvironmentsPanel projectPath={projectPath} />
      </CollapsibleSection>

      {/* Launch Guard */}
      <CollapsibleSection
        title="Launch Guard"
        icon={<Shield size={14} className="text-indigo-400" />}
        defaultOpen={false}
      >
        <LaunchGuardPanel projectPath={projectPath} />
      </CollapsibleSection>

      {/* Environment Variables */}
      {envFiles.length > 0 && (
        <CollapsibleSection
          title="Environment Variables"
          count={envFiles.reduce((sum, f) => sum + f.varCount, 0)}
          icon={<KeyRound size={14} className="text-green-400" />}
        >
          <EnvFilePanel files={envFiles} />
        </CollapsibleSection>
      )}

      {/* Env Doctor */}
      <CollapsibleSection
        title="Env Doctor"
        icon={<Stethoscope size={14} className="text-teal-400" />}
        defaultOpen={false}
      >
        <EnvDoctorPanel projectPath={projectPath} />
      </CollapsibleSection>

      {/* Environment Templates */}
      {templates.length > 0 && (
        <CollapsibleSection
          title="Environment Templates"
          count={templates.length}
          icon={<FileText size={14} className="text-purple-400" />}
        >
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div
                key={tpl.path}
                className="flex items-center gap-3 bg-neutral-800/40 rounded-lg border border-neutral-800 p-3"
              >
                <div className="p-2 bg-neutral-800 rounded-lg shrink-0">
                  <FileText size={16} className="text-neutral-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 font-medium truncate">{tpl.name}</p>
                  <p className="text-[10px] text-neutral-500">
                    {tpl.vars.length} variable{tpl.vars.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}
