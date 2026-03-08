import { ipcMain, app } from 'electron'
import Database from 'better-sqlite3'
import { VisualBaselineDAO } from '../database/dao/VisualBaselineDAO'
import * as path from 'path'
import * as fs from 'fs'

function getBaselinesDir(): string {
  const dir = path.join(app.getPath('userData'), 'visual-baselines')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Simple pixel-level image comparison.
 * Takes two PNG buffers, compares them pixel by pixel with tolerance,
 * and returns diff percentage + diff image buffer.
 */
function compareImages(
  baselineBuffer: Buffer,
  currentBuffer: Buffer
): { diffPercent: number; diffBuffer: Buffer } {
  // Use Electron's nativeImage to decode PNG to raw pixels
  const { nativeImage } = require('electron')

  const baselineImg = nativeImage.createFromBuffer(baselineBuffer)
  const currentImg = nativeImage.createFromBuffer(currentBuffer)

  const baselineBitmap = baselineImg.toBitmap()
  const currentBitmap = currentImg.toBitmap()

  const baselineSize = baselineImg.getSize()
  const currentSize = currentImg.getSize()

  // If sizes differ, resize current to match baseline
  let bitmapToCompare = currentBitmap
  let compareWidth = baselineSize.width
  let compareHeight = baselineSize.height

  if (baselineSize.width !== currentSize.width || baselineSize.height !== currentSize.height) {
    const resized = currentImg.resize({ width: baselineSize.width, height: baselineSize.height })
    bitmapToCompare = resized.toBitmap()
  }

  const totalPixels = compareWidth * compareHeight
  let diffPixels = 0
  const TOLERANCE = 10 // Allow small color variations

  // Create diff bitmap (BGRA format)
  const diffBitmap = Buffer.alloc(baselineBitmap.length)

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4 // BGRA
    const bB = baselineBitmap[offset]
    const bG = baselineBitmap[offset + 1]
    const bR = baselineBitmap[offset + 2]
    const bA = baselineBitmap[offset + 3]

    const cB = bitmapToCompare[offset]
    const cG = bitmapToCompare[offset + 1]
    const cR = bitmapToCompare[offset + 2]
    const cA = bitmapToCompare[offset + 3]

    const dR = Math.abs(bR - cR)
    const dG = Math.abs(bG - cG)
    const dB = Math.abs(bB - cB)
    const dA = Math.abs(bA - cA)

    if (dR > TOLERANCE || dG > TOLERANCE || dB > TOLERANCE || dA > TOLERANCE) {
      diffPixels++
      // Highlight diff in red (BGRA)
      diffBitmap[offset] = 0       // B
      diffBitmap[offset + 1] = 0   // G
      diffBitmap[offset + 2] = 255 // R
      diffBitmap[offset + 3] = 200 // A
    } else {
      // Keep original but dimmed
      diffBitmap[offset] = Math.round(bB * 0.3)
      diffBitmap[offset + 1] = Math.round(bG * 0.3)
      diffBitmap[offset + 2] = Math.round(bR * 0.3)
      diffBitmap[offset + 3] = bA
    }
  }

  const diffPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0

  // Convert diff bitmap back to PNG
  const diffImg = nativeImage.createFromBitmap(diffBitmap, {
    width: compareWidth,
    height: compareHeight,
  })
  const diffBuffer = diffImg.toPNG()

  return { diffPercent, diffBuffer }
}

export function registerVisualBaselineHandlers(db: Database.Database) {
  const dao = new VisualBaselineDAO(db)

  ipcMain.handle(
    'visual:saveBaseline',
    async (
      _e,
      data: {
        projectId: string
        routeKey: string
        pageUrl: string
        viewportWidth: number
        viewportHeight: number
        label?: string
        imageDataUrl: string
      }
    ) => {
      const dir = getBaselinesDir()
      const timestamp = Date.now()
      const safeRoute = data.routeKey.replace(/[^a-zA-Z0-9_-]/g, '_')
      const filename = `baseline_${data.projectId}_${safeRoute}_${timestamp}.png`
      const filePath = path.join(dir, filename)

      // Decode base64 data URL to buffer
      const base64Data = data.imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(filePath, buffer)

      return dao.createBaseline({
        projectId: data.projectId,
        routeKey: data.routeKey,
        pageUrl: data.pageUrl,
        viewportWidth: data.viewportWidth,
        viewportHeight: data.viewportHeight,
        label: data.label,
        imagePath: filePath,
      })
    }
  )

  ipcMain.handle(
    'visual:listBaselines',
    (_e, projectId: string, routeKey?: string) =>
      dao.listBaselines(projectId, routeKey)
  )

  ipcMain.handle('visual:getBaseline', (_e, id: number) =>
    dao.getBaseline(id)
  )

  ipcMain.handle(
    'visual:compare',
    async (
      _e,
      data: {
        baselineId: number
        projectId: string
        currentImageDataUrl: string
      }
    ) => {
      const baseline = dao.getBaseline(data.baselineId)
      if (!baseline) {
        return { error: 'Baseline not found' }
      }

      if (!fs.existsSync(baseline.imagePath)) {
        return { error: 'Baseline image file not found on disk' }
      }

      const dir = getBaselinesDir()
      const timestamp = Date.now()

      // Save current screenshot
      const currentFilename = `current_${data.projectId}_${timestamp}.png`
      const currentPath = path.join(dir, currentFilename)
      const base64Data = data.currentImageDataUrl.replace(/^data:image\/\w+;base64,/, '')
      const currentBuffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(currentPath, currentBuffer)

      // Load baseline image
      const baselineBuffer = fs.readFileSync(baseline.imagePath)

      // Compare
      const { diffPercent, diffBuffer } = compareImages(baselineBuffer, currentBuffer)

      // Save diff image
      const diffFilename = `diff_${data.projectId}_${timestamp}.png`
      const diffPath = path.join(dir, diffFilename)
      fs.writeFileSync(diffPath, diffBuffer)

      // Determine status
      const status = diffPercent < 0.1 ? 'passed' : diffPercent < 5 ? 'pending' : 'failed'

      const comparison = dao.createComparison({
        projectId: data.projectId,
        baselineId: data.baselineId,
        currentImagePath: currentPath,
        diffImagePath: diffPath,
        diffPercent: Math.round(diffPercent * 100) / 100,
        status,
      })

      // Read images as data URLs for the renderer
      const baselineDataUrl = `data:image/png;base64,${baselineBuffer.toString('base64')}`
      const diffDataUrl = `data:image/png;base64,${diffBuffer.toString('base64')}`

      return {
        comparison,
        baselineDataUrl,
        currentDataUrl: data.currentImageDataUrl,
        diffDataUrl,
      }
    }
  )

  ipcMain.handle(
    'visual:approveBaseline',
    async (
      _e,
      data: {
        comparisonId: number
        baselineId: number
      }
    ) => {
      const comparison = dao.getLatestComparison(data.baselineId)
      if (!comparison) {
        return { error: 'Comparison not found' }
      }

      // Update comparison status to approved
      dao.updateComparisonStatus(data.comparisonId, 'approved')

      // Replace the baseline image with the current image
      const baseline = dao.getBaseline(data.baselineId)
      if (baseline && fs.existsSync(comparison.currentImagePath)) {
        fs.copyFileSync(comparison.currentImagePath, baseline.imagePath)
      }

      return { success: true }
    }
  )

  ipcMain.handle('visual:deleteBaseline', (_e, id: number) =>
    dao.deleteBaseline(id)
  )
}
