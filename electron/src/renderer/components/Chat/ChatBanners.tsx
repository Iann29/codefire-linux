import { AlertTriangle, X } from 'lucide-react'
import type { RateLimitInfo } from '@shared/models'

// ─── ChatBanners Props ───────────────────────────────────────────────────────

export interface ChatBannersProps {
  rateLimitInfo: RateLimitInfo | null
  rateLimitDismissed: boolean
  rateLimitCountdown: string
  onDismissRateLimit: () => void
  errorMessage: string | null
}

// ─── ChatBanners Component ───────────────────────────────────────────────────

export default function ChatBanners({
  rateLimitInfo,
  rateLimitDismissed,
  rateLimitCountdown,
  onDismissRateLimit,
  errorMessage,
}: ChatBannersProps) {
  return (
    <>
      {/* Rate limit banner */}
      {rateLimitInfo && !rateLimitDismissed && (
        <div className="px-3 py-2 bg-yellow-500/10 border-t border-yellow-500/20 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
            <p className="text-[11px] text-yellow-300 flex-1">
              <span className="font-medium">{rateLimitInfo.providerName}</span> rate limited
              {rateLimitInfo.fallbackProvider && (
                <span> — using <span className="font-medium">{rateLimitInfo.fallbackProvider}</span></span>
              )}
              {rateLimitCountdown && (
                <span className="text-yellow-400/70"> (back in {rateLimitCountdown})</span>
              )}
            </p>
            {rateLimitInfo.limit !== null && rateLimitInfo.remaining !== null && (
              <span className="text-[9px] text-yellow-500/60 shrink-0">
                {rateLimitInfo.remaining}/{rateLimitInfo.limit}
              </span>
            )}
            <button
              onClick={onDismissRateLimit}
              className="text-yellow-500/50 hover:text-yellow-400 transition-colors shrink-0"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="px-3 py-2 bg-red-900/30 border-t border-red-800/50 shrink-0">
          <p className="text-[11px] text-red-300">{errorMessage}</p>
        </div>
      )}
    </>
  )
}
