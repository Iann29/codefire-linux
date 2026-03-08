export interface ViewportPreset {
  id: string
  label: string
  width: number
  height: number
  category: 'mobile' | 'tablet' | 'laptop' | 'desktop'
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, category: 'mobile' },
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, category: 'mobile' },
  { id: 'android-md', label: 'Android Medium', width: 412, height: 915, category: 'mobile' },
  { id: 'ipad', label: 'iPad', width: 820, height: 1180, category: 'tablet' },
  { id: 'laptop', label: 'Laptop', width: 1366, height: 768, category: 'laptop' },
  { id: 'desktop', label: 'Desktop', width: 1920, height: 1080, category: 'desktop' },
  { id: 'desktop-wide', label: 'Desktop Wide', width: 2560, height: 1440, category: 'desktop' },
]

export const DEFAULT_VIEWPORT = VIEWPORT_PRESETS.find(p => p.id === 'desktop')!
