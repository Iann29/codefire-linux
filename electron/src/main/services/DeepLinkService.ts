export type CLIProvider = 'claude' | 'gemini' | 'codex' | 'opencode'

export interface DeepLinkResult {
  success: boolean
  cli: CLIProvider
  displayName: string
  error?: string
}

/**
 * Parses codefire:// deep link URLs.
 *
 * Previously handled MCP configuration install links.
 * Deep link infrastructure is preserved for future use.
 */
export class DeepLinkService {
  /**
   * Parse and handle a codefire:// URL.
   * Returns null if the URL is not a valid/supported deep link.
   */
  handleURL(urlString: string): DeepLinkResult | null {
    let url: URL
    try {
      url = new URL(urlString)
    } catch {
      return null
    }

    if (url.protocol !== 'codefire:') return null

    // No supported deep link routes at this time
    return null
  }
}
