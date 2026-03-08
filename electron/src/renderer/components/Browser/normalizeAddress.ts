export type AddressResult =
  | { kind: 'noop' }
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string }
  | { kind: 'invalid'; reason: string }

export function normalizeAddress(raw: string): AddressResult {
  const trimmed = raw.trim()

  // Empty → no-op
  if (!trimmed) return { kind: 'noop' }

  // about: protocol → pass through
  if (trimmed.startsWith('about:')) return { kind: 'url', url: trimmed }

  // Already has protocol
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const u = new URL(trimmed)
      if (!u.hostname) return { kind: 'invalid', reason: 'Missing hostname' }
      return { kind: 'url', url: trimmed }
    } catch {
      return { kind: 'invalid', reason: 'Invalid URL' }
    }
  }

  // Bare protocol without host
  if (/^https?:\/\/?$/i.test(trimmed)) {
    return { kind: 'invalid', reason: 'Enter a full URL or search term' }
  }

  // Has spaces → search query
  if (trimmed.includes(' ')) {
    return {
      kind: 'search',
      url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
    }
  }

  // Looks like a domain (has dot, no spaces)
  if (trimmed.includes('.')) {
    return { kind: 'url', url: `https://${trimmed}` }
  }

  // Single word without dot → search
  return {
    kind: 'search',
    url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
  }
}
