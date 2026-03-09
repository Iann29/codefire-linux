const BROWSER_INTENT_PATTERNS = [
  /\bbrowser\b/i,
  /\bnavigate\b/i,
  /\bopen (the )?(site|page|app)\b/i,
  /\bvisit\b/i,
  /\bscreenshot\b/i,
  /\bvisual\b/i,
  /\bdom\b/i,
  /\blogin\b/i,
  /\blog in\b/i,
  /\bsign in\b/i,
  /\bclick\b/i,
  /\btype\b/i,
  /\bfill\b/i,
  /\bform\b/i,
  /\btest\b/i,
  /\bui\b/i,
  /\bpage\b/i,
  /\bsite\b/i,
  /\bnaveg/i,
  /\babr[ei]\b/i,
  /\btesta[r]?\b/i,
  /\bclique\b/i,
  /\bclicar\b/i,
  /\bdigitar\b/i,
  /\bformulario\b/i,
]

export function detectBrowserIntent(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  return BROWSER_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed))
}
