import { useState, useCallback } from 'react'
import { DEFAULT_VIEWPORT } from '@renderer/components/Browser/viewportPresets'

export interface BrowserTab {
  id: string
  url: string
  title: string
  isLoading: boolean
  viewportPresetId: string
  viewportWidth: number
  viewportHeight: number
}

let tabCounter = 0

function createTab(url: string): BrowserTab {
  return {
    id: `tab-${++tabCounter}`,
    url,
    title: 'New Tab',
    isLoading: false,
    viewportPresetId: DEFAULT_VIEWPORT.id,
    viewportWidth: DEFAULT_VIEWPORT.width,
    viewportHeight: DEFAULT_VIEWPORT.height,
  }
}

export function useBrowserTabs(defaultUrl = 'https://www.google.com') {
  const [tabs, setTabs] = useState<BrowserTab[]>([createTab(defaultUrl)])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)

  const addTab = useCallback((url = 'about:blank') => {
    const tab = createTab(url)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    return tab.id
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== id)
        if (filtered.length === 0) {
          const newTab = createTab('about:blank')
          setActiveTabId(newTab.id)
          return [newTab]
        }
        if (activeTabId === id) {
          setActiveTabId(filtered[filtered.length - 1].id)
        }
        return filtered
      })
    },
    [activeTabId]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Omit<BrowserTab, 'id'>>) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      )
    },
    []
  )

  const navigateTab = useCallback(
    (id: string, url: string) => {
      updateTab(id, { url, isLoading: true })
    },
    [updateTab]
  )

  const setTabViewport = useCallback(
    (id: string, presetId: string, width: number, height: number) => {
      updateTab(id, { viewportPresetId: presetId, viewportWidth: width, viewportHeight: height })
    },
    [updateTab]
  )

  const resetTabs = useCallback(() => {
    const tab = createTab('about:blank')
    setTabs([tab])
    setActiveTabId(tab.id)
    return tab.id
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  return {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updateTab,
    navigateTab,
    setTabViewport,
    resetTabs,
  }
}
