import { useState, useEffect, lazy, Suspense, createContext, useContext, useCallback } from 'react'
import DeepLinkModal from '@renderer/components/DeepLinkModal'
import type { AppConfig } from '@shared/models'
import { api } from '@renderer/lib/api'

const MainLayout = lazy(() => import('@renderer/layouts/MainLayout'))
const ProjectLayout = lazy(() => import('@renderer/layouts/ProjectLayout'))
const SettingsModal = lazy(() => import('@renderer/components/Settings/SettingsModal'))
const OnboardingWizard = lazy(
  () => import('@renderer/components/Onboarding/OnboardingWizard')
)

interface NavigationContextType {
  navigateToProject: (projectId: string) => void
  navigateHome: () => void
}

const NavigationContext = createContext<NavigationContextType>({
  navigateToProject: () => {},
  navigateHome: () => {},
})

export function useNavigation() {
  return useContext(NavigationContext)
}

export default function App() {
  // Initial projectId from URL (for existing multi-window support)
  const params = new URLSearchParams(window.location.search)
  const urlProjectId = params.get('projectId')

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(urlProjectId)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  const navigateToProject = useCallback((projectId: string) => {
    setCurrentProjectId(projectId)
    window.history.pushState({}, '', `?projectId=${projectId}`)
    document.title = 'Pinyino'
  }, [])

  const navigateHome = useCallback(() => {
    setCurrentProjectId(null)
    window.history.pushState({}, '', '/')
    document.title = 'Pinyino'
  }, [])

  // Load config and check if onboarding is needed
  useEffect(() => {
    let cancelled = false

    async function checkOnboarding() {
      try {
        const cfg = await api.settings.get()
        if (cancelled) return
        setConfig(cfg)

        const provider = cfg.aiProvider || 'openrouter'
        const hasOpenRouterKey = provider === 'openrouter' && !!cfg.openRouterKey
        const hasCustomEndpoint = provider === 'custom' && !!cfg.customEndpointUrl

        // If using a key-based provider that already has a key, no onboarding needed
        if (hasOpenRouterKey || hasCustomEndpoint) return

        // If using a subscription provider, check if connected
        if (provider.endsWith('-subscription')) {
          const accounts = await api.provider.listAccounts().catch(() => [])
          if (cancelled) return
          const hasAccount = accounts.some((a) => a.providerId === provider && !a.isExpired)
          if (hasAccount) return
        }

        // For default state (openrouter with no key) also check for any connected subscription
        if (provider === 'openrouter' && !cfg.openRouterKey) {
          const accounts = await api.provider.listAccounts().catch(() => [])
          if (cancelled) return
          const hasAnyAccount = accounts.some((a) => !a.isExpired)
          if (hasAnyAccount) return
        }

        // No provider configured — show onboarding
        setShowOnboarding(true)
      } catch {
        // If settings fail to load, don't block the app
      }
    }

    checkOnboarding()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    return window.api.on('menu:openSettings', () => setShowSettings(true))
  }, [])

  function handleOnboardingChange(patch: Partial<AppConfig>) {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function handleOnboardingClose() {
    setShowOnboarding(false)
    setOnboardingDismissed(true)
  }

  const shouldShowOnboarding = showOnboarding && !onboardingDismissed && config !== null

  return (
    <NavigationContext.Provider value={{ navigateToProject, navigateHome }}>
      <Suspense fallback={<div className="h-screen w-screen bg-neutral-900" />}>
        {currentProjectId ? <ProjectLayout projectId={currentProjectId} /> : <MainLayout />}
      </Suspense>
      <DeepLinkModal />
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {shouldShowOnboarding && (
        <Suspense fallback={null}>
          <OnboardingWizard
            config={config}
            onChange={handleOnboardingChange}
            onClose={handleOnboardingClose}
          />
        </Suspense>
      )}
    </NavigationContext.Provider>
  )
}
