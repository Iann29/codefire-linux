import * as Icons from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ForwardRefExoticComponent, RefAttributes } from 'react'

interface ServiceCardProps {
  name: string
  configFile: string
  dashboardUrl: string | null
  icon: string
}

type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>

function getIcon(iconName: string): LucideIcon {
  const lookup = Icons as Record<string, unknown>
  const icon = lookup[iconName]
  if (icon && typeof icon === 'object' && 'render' in icon) {
    return icon as LucideIcon
  }
  return Icons.Box
}

export default function ServiceCard({ name, configFile, dashboardUrl, icon }: ServiceCardProps) {
  const IconComponent = getIcon(icon)

  return (
    <div className="flex items-center gap-3 bg-neutral-800/40 rounded-lg border border-neutral-800 p-3">
      <div className="p-2 bg-neutral-800 rounded-lg shrink-0">
        <IconComponent size={16} className="text-neutral-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-neutral-200 font-medium truncate">{name}</p>
        <p className="text-[10px] text-neutral-500 truncate">{configFile}</p>
      </div>
      {dashboardUrl && (
        <button
          type="button"
          onClick={() => window.open(dashboardUrl, '_blank')}
          className="text-[10px] text-codefire-orange hover:text-codefire-orange/80 transition-colors shrink-0"
        >
          Open
        </button>
      )}
    </div>
  )
}
