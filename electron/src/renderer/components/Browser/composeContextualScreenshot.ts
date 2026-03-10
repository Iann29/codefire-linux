/**
 * Composes a contextual screenshot: original screenshot + context rail.
 * Uses a standard HTMLCanvasElement for maximum Electron compatibility.
 */
import type { PageContextEvidence } from '@shared/models'

// ─── Layout constants ────────────────────────────────────────────────────────

const RAIL_WIDTH = 310
const RAIL_PADDING = 16
const SECTION_GAP = 14
const LINE_HEIGHT = 16
const HEADING_HEIGHT = 20
const BADGE_HEIGHT = 14
const MAX_VISIBLE_COMPONENTS = 8
const MAX_VISIBLE_BACKEND = 6

// ─── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  railBg: '#171717',       // neutral-900
  sectionBg: '#262626',    // neutral-800
  heading: '#a3a3a3',      // neutral-400
  text: '#d4d4d4',         // neutral-300
  subtext: '#737373',      // neutral-500
  accent: '#ff6b35',       // codefire-orange
  confirmed: '#22c55e',    // green-500
  inferred: '#eab308',     // yellow-500
  none: '#525252',         // neutral-600
  border: '#404040',       // neutral-700
  badgeBg: '#1a1a1a',
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '\u2026'
}

function confidenceColor(c: 'confirmed' | 'inferred' | 'none'): string {
  return COLORS[c]
}

function confidenceLabel(c: 'confirmed' | 'inferred' | 'none'): string {
  return c === 'confirmed' ? '\u2713' : c === 'inferred' ? '~' : '?'
}

// ─── Section height calculation ──────────────────────────────────────────────

function calcPageSectionHeight(): number {
  return HEADING_HEIGHT + LINE_HEIGHT * 2 + 8
}

function calcRouteSectionHeight(evidence: PageContextEvidence): number {
  let lines = 1
  if (evidence.route.filePath) lines++
  if (evidence.route.framework) lines++
  return HEADING_HEIGHT + LINE_HEIGHT * lines + 8
}

function calcComponentsSectionHeight(evidence: PageContextEvidence): number {
  const count = Math.min(evidence.components.length, MAX_VISIBLE_COMPONENTS)
  const extra = evidence.components.length > MAX_VISIBLE_COMPONENTS ? 1 : 0
  return HEADING_HEIGHT + LINE_HEIGHT * (count + extra) + 8
}

function calcBackendSectionHeight(evidence: PageContextEvidence): number {
  const count = Math.min(evidence.backend.length, MAX_VISIBLE_BACKEND)
  const extra = evidence.backend.length > MAX_VISIBLE_BACKEND ? 1 : 0
  return HEADING_HEIGHT + LINE_HEIGHT * (count + extra) + 8
}

// ─── Main composition function ───────────────────────────────────────────────

export async function composeContextualScreenshot(
  screenshotDataUrl: string,
  evidence: PageContextEvidence
): Promise<string> {
  // Load the screenshot image via HTMLImageElement (most compatible in Electron)
  const img = await loadImage(screenshotDataUrl)

  // Calculate rail content height
  const pageH = calcPageSectionHeight()
  const routeH = evidence.route.matchedPath ? calcRouteSectionHeight(evidence) : 0
  const componentsH = evidence.components.length > 0 ? calcComponentsSectionHeight(evidence) : 0
  const backendH = evidence.backend.length > 0 ? calcBackendSectionHeight(evidence) : 0

  const sections = [pageH, routeH, componentsH, backendH].filter(h => h > 0)
  const railContentH = sections.reduce((a, b) => a + b, 0) + (sections.length - 1) * SECTION_GAP + RAIL_PADDING * 2

  // Final canvas dimensions
  const canvasW = img.naturalWidth + RAIL_WIDTH
  const canvasH = Math.max(img.naturalHeight, railContentH)

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas 2d context')

  // Draw screenshot
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight)

  // Fill remaining height below screenshot if canvas is taller
  if (canvasH > img.naturalHeight) {
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, img.naturalHeight, img.naturalWidth, canvasH - img.naturalHeight)
  }

  // Draw rail background
  ctx.fillStyle = COLORS.railBg
  ctx.fillRect(img.naturalWidth, 0, RAIL_WIDTH, canvasH)

  // Rail left border
  ctx.fillStyle = COLORS.border
  ctx.fillRect(img.naturalWidth, 0, 1, canvasH)

  let y = RAIL_PADDING

  // ── Page section ─────────────────────────────────────────────────────────
  y = drawSection(ctx, img.naturalWidth, y, 'Page', () => {
    let localY = 0

    ctx.fillStyle = COLORS.text
    ctx.font = '12px monospace'
    ctx.fillText(truncate(evidence.pageUrl, 34), 0, localY + 12)
    localY += LINE_HEIGHT

    if (evidence.pageTitle) {
      ctx.fillStyle = COLORS.subtext
      ctx.font = '11px sans-serif'
      ctx.fillText(truncate(evidence.pageTitle, 36), 0, localY + 12)
    }
    localY += LINE_HEIGHT

    return localY
  })

  y += SECTION_GAP

  // ── Route section ────────────────────────────────────────────────────────
  if (evidence.route.matchedPath) {
    y = drawSection(ctx, img.naturalWidth, y, 'Route', () => {
      let localY = 0

      ctx.fillStyle = COLORS.text
      ctx.font = '12px monospace'
      ctx.fillText(truncate(evidence.route.matchedPath!, 26), 0, localY + 12)
      drawBadge(ctx, RAIL_WIDTH - RAIL_PADDING * 2 - 30, localY + 1, evidence.route.confidence)
      localY += LINE_HEIGHT

      if (evidence.route.filePath) {
        ctx.fillStyle = COLORS.subtext
        ctx.font = '11px monospace'
        ctx.fillText(truncate(evidence.route.filePath, 34), 0, localY + 12)
        localY += LINE_HEIGHT
      }

      if (evidence.route.framework) {
        ctx.fillStyle = COLORS.accent
        ctx.font = '10px sans-serif'
        ctx.fillText(evidence.route.framework, 0, localY + 12)
        localY += LINE_HEIGHT
      }

      return localY
    })

    y += SECTION_GAP
  }

  // ── Components section ───────────────────────────────────────────────────
  if (evidence.components.length > 0) {
    y = drawSection(ctx, img.naturalWidth, y, `Components (${evidence.components.length})`, () => {
      let localY = 0
      const visible = evidence.components.slice(0, MAX_VISIBLE_COMPONENTS)

      for (const comp of visible) {
        ctx.fillStyle = COLORS.text
        ctx.font = '11px monospace'
        ctx.fillText(truncate(comp.name, 28), 0, localY + 12)
        drawBadge(ctx, RAIL_WIDTH - RAIL_PADDING * 2 - 30, localY + 1, comp.confidence)
        localY += LINE_HEIGHT
      }

      if (evidence.components.length > MAX_VISIBLE_COMPONENTS) {
        ctx.fillStyle = COLORS.subtext
        ctx.font = '10px sans-serif'
        ctx.fillText(`+${evidence.components.length - MAX_VISIBLE_COMPONENTS} more`, 0, localY + 12)
        localY += LINE_HEIGHT
      }

      return localY
    })

    y += SECTION_GAP
  }

  // ── Backend section ──────────────────────────────────────────────────────
  if (evidence.backend.length > 0) {
    y = drawSection(ctx, img.naturalWidth, y, `Backend (${evidence.backend.length})`, () => {
      let localY = 0
      const visible = evidence.backend.slice(0, MAX_VISIBLE_BACKEND)

      for (const item of visible) {
        ctx.fillStyle = COLORS.text
        ctx.font = '11px monospace'
        ctx.fillText(truncate(item.label, 28), 0, localY + 12)
        drawBadge(ctx, RAIL_WIDTH - RAIL_PADDING * 2 - 30, localY + 1, item.confidence)
        localY += LINE_HEIGHT
      }

      if (evidence.backend.length > MAX_VISIBLE_BACKEND) {
        ctx.fillStyle = COLORS.subtext
        ctx.font = '10px sans-serif'
        ctx.fillText(`+${evidence.backend.length - MAX_VISIBLE_BACKEND} more`, 0, localY + 12)
        localY += LINE_HEIGHT
      }

      return localY
    })
  }

  // ── Watermark ────────────────────────────────────────────────────────────
  ctx.fillStyle = COLORS.subtext
  ctx.font = '9px sans-serif'
  ctx.fillText('Context Shot', img.naturalWidth + RAIL_PADDING, canvasH - 8)

  // Convert directly to data URL (synchronous, no blob/FileReader needed)
  return canvas.toDataURL('image/png')
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

function drawSection(
  ctx: CanvasRenderingContext2D,
  railX: number,
  startY: number,
  title: string,
  drawContent: () => number
): number {
  const x = railX + RAIL_PADDING
  const contentWidth = RAIL_WIDTH - RAIL_PADDING * 2

  // Section heading
  ctx.fillStyle = COLORS.heading
  ctx.font = 'bold 10px sans-serif'
  ctx.fillText(title.toUpperCase(), x, startY + 12)

  const contentStartY = startY + HEADING_HEIGHT

  ctx.save()
  ctx.translate(x, contentStartY)

  // Clip to content width
  ctx.beginPath()
  ctx.rect(0, -2, contentWidth, 500)
  ctx.clip()

  const contentHeight = drawContent()
  ctx.restore()

  return contentStartY + contentHeight
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  confidence: 'confirmed' | 'inferred' | 'none'
): void {
  const label = confidenceLabel(confidence)
  const color = confidenceColor(confidence)
  const badgeW = 22

  // Badge background
  ctx.fillStyle = COLORS.badgeBg
  drawRoundRect(ctx, x, y, badgeW, BADGE_HEIGHT, 3)
  ctx.fill()

  // Badge border
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  drawRoundRect(ctx, x, y, badgeW, BADGE_HEIGHT, 3)
  ctx.stroke()

  // Badge text
  ctx.fillStyle = color
  ctx.font = 'bold 9px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(label, x + badgeW / 2, y + 10)
  ctx.textAlign = 'left'
}

/** Manual rounded rect using arcs — avoids ctx.roundRect() compatibility issues */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

// ─── Image loading ───────────────────────────────────────────────────────────

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (_e) => reject(new Error('Failed to load screenshot image'))
    img.src = dataUrl
  })
}
