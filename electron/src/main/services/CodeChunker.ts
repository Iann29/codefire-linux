// ─── Types ───────────────────────────────────────────────────────────────────

export interface Chunk {
  chunkType: 'function' | 'class' | 'block' | 'doc' | 'commit' | 'header'
  symbolName: string | null
  content: string
  startLine: number | null
  endLine: number | null
}

// ─── Language Detection ──────────────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  '.swift': 'swift',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.md': 'markdown',
}

export function detectLanguage(filePath: string): string | null {
  const dotIdx = filePath.lastIndexOf('.')
  if (dotIdx < 0) return null
  const ext = filePath.slice(dotIdx).toLowerCase()
  return EXTENSION_MAP[ext] ?? null
}

// ─── Language Patterns ───────────────────────────────────────────────────────

interface BoundaryPattern {
  regex: RegExp
  type: 'function' | 'class'
}

function getPatternsForLanguage(language: string): BoundaryPattern[] | null {
  switch (language) {
    case 'swift':
      return [
        {
          regex:
            /^\s*(public |private |internal |open |fileprivate )?(static |class )?(func |init\(|deinit\b)/,
          type: 'function',
        },
        {
          regex:
            /^\s*(public |private |internal |open |fileprivate )?(final )?(class |struct |enum |protocol |extension )/,
          type: 'class',
        },
      ]

    case 'typescript':
    case 'javascript':
      return [
        {
          regex: /^\s*(export\s+)?(async\s+)?function\s+/,
          type: 'function',
        },
        {
          regex: /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
          type: 'function',
        },
        {
          regex: /^\s*(export\s+)?(abstract\s+)?(class|interface|type)\s+/,
          type: 'class',
        },
      ]

    case 'python':
    case 'ruby':
      return [
        { regex: /^\s*(async\s+)?def\s+/, type: 'function' },
        { regex: /^\s*class\s+/, type: 'class' },
      ]

    case 'rust':
      return [
        { regex: /^\s*(pub\s+)?(async\s+)?fn\s+/, type: 'function' },
        {
          regex: /^\s*(pub\s+)?(struct|enum|impl|trait)\s+/,
          type: 'class',
        },
      ]

    case 'go':
      return [
        { regex: /^func\s+/, type: 'function' },
        {
          regex: /^type\s+\w+\s+(struct|interface)/,
          type: 'class',
        },
      ]

    case 'java':
    case 'csharp':
    case 'cpp':
      return [
        {
          regex:
            /^\s*(public |private |protected )?(static )?\w+[\w<>,\s]*\s+\w+\s*\(/,
          type: 'function',
        },
        {
          regex:
            /^\s*(public |private |protected )?(abstract )?(class|interface|enum)\s+/,
          type: 'class',
        },
      ]

    case 'php':
      return [
        {
          regex: /^\s*(export\s+)?(async\s+)?function\s+/,
          type: 'function',
        },
        {
          regex: /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
          type: 'function',
        },
        {
          regex: /^\s*(export\s+)?(abstract\s+)?(class|interface|type)\s+/,
          type: 'class',
        },
      ]

    default:
      return null
  }
}

// ─── Symbol Name Extraction ──────────────────────────────────────────────────

function extractSymbolName(
  line: string,
  boundaryType: 'function' | 'class',
  language: string
): string | null {
  const trimmed = line.trim()

  if (language === 'swift') {
    if (boundaryType === 'function') {
      // init( or deinit
      if (trimmed.includes('init(')) return 'init'
      if (trimmed.includes('deinit')) return 'deinit'
      // func name(
      const funcMatch = trimmed.match(/func\s+(\w+)/)
      return funcMatch ? funcMatch[1] : null
    } else {
      // class/struct/enum/protocol/extension Name
      const match = trimmed.match(
        /(class|struct|enum|protocol|extension)\s+(\w+)/
      )
      return match ? match[2] : null
    }
  }

  if (
    language === 'typescript' ||
    language === 'javascript' ||
    language === 'php'
  ) {
    if (boundaryType === 'function') {
      // function name(
      const funcMatch = trimmed.match(/function\s+(\w+)/)
      if (funcMatch) return funcMatch[1]
      // const name = (
      const arrowMatch = trimmed.match(
        /(?:const|let|var)\s+(\w+)\s*=/
      )
      return arrowMatch ? arrowMatch[1] : null
    } else {
      const match = trimmed.match(/(class|interface|type)\s+(\w+)/)
      return match ? match[2] : null
    }
  }

  if (language === 'python' || language === 'ruby') {
    if (boundaryType === 'function') {
      const match = trimmed.match(/def\s+(\w+)/)
      return match ? match[1] : null
    } else {
      const match = trimmed.match(/class\s+(\w+)/)
      return match ? match[1] : null
    }
  }

  if (language === 'rust') {
    if (boundaryType === 'function') {
      const match = trimmed.match(/fn\s+(\w+)/)
      return match ? match[1] : null
    } else {
      const match = trimmed.match(/(struct|enum|impl|trait)\s+(\w+)/)
      return match ? match[2] : null
    }
  }

  if (language === 'go') {
    if (boundaryType === 'function') {
      // func (receiver) Name or func Name
      const methodMatch = trimmed.match(/func\s+\([^)]+\)\s*(\w+)/)
      if (methodMatch) return methodMatch[1]
      const funcMatch = trimmed.match(/func\s+(\w+)/)
      return funcMatch ? funcMatch[1] : null
    } else {
      const match = trimmed.match(/type\s+(\w+)/)
      return match ? match[1] : null
    }
  }

  if (language === 'java' || language === 'csharp' || language === 'cpp') {
    if (boundaryType === 'class') {
      const match = trimmed.match(/(class|interface|enum)\s+(\w+)/)
      return match ? match[2] : null
    } else {
      // Method: look for the identifier before the opening paren
      const match = trimmed.match(/(\w+)\s*\(/)
      return match ? match[1] : null
    }
  }

  return null
}

// ─── Boundary Match ──────────────────────────────────────────────────────────

interface BoundaryMatch {
  type: 'function' | 'class'
  symbolName: string | null
}

function matchBoundary(
  line: string,
  patterns: BoundaryPattern[],
  language: string
): BoundaryMatch | null {
  for (const pattern of patterns) {
    if (pattern.regex.test(line)) {
      return {
        type: pattern.type,
        symbolName: extractSymbolName(line, pattern.type, language),
      }
    }
  }
  return null
}

// ─── Core Chunking ───────────────────────────────────────────────────────────

const MAX_CHUNK_LINES = 100
const MIN_CHUNK_CHARS = 20
const MIN_BLOCK_LINES = 5
const HEADER_SCAN_LINES = 30

/**
 * Chunk a file using language-aware boundary detection.
 *
 * Algorithm:
 * 1. Scan first 30 lines for first boundary → everything before is "header"
 * 2. Accumulate lines between boundaries
 * 3. When hitting a new boundary: emit previous chunk, start new one
 * 4. Track parent class name for nested methods
 * 5. Split chunks exceeding 100 lines at next blank line
 * 6. Discard chunks < 20 chars or < 5 lines (for blocks)
 */
export function chunkFile(
  content: string,
  language: string | null
): Chunk[] {
  if (!content || content.trim().length === 0) return []

  // Markdown gets special treatment
  if (language === 'markdown') return chunkMarkdown(content)

  const patterns = language ? getPatternsForLanguage(language) : null
  if (!patterns) return chunkFallback(content)

  const lines = content.split('\n')
  const chunks: Chunk[] = []

  // Find first boundary within the scan window
  let firstBoundaryLine = -1
  for (let i = 0; i < Math.min(lines.length, HEADER_SCAN_LINES); i++) {
    if (matchBoundary(lines[i], patterns, language!)) {
      firstBoundaryLine = i
      break
    }
  }

  // Emit header chunk if there's content before first boundary
  if (firstBoundaryLine > 0) {
    const headerContent = lines.slice(0, firstBoundaryLine).join('\n').trim()
    if (headerContent.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunkType: 'header',
        symbolName: null,
        content: headerContent,
        startLine: 1,
        endLine: firstBoundaryLine,
      })
    }
  }

  // Now process boundaries
  let currentChunkLines: string[] = []
  let currentChunkType: 'function' | 'class' | 'block' = 'block'
  let currentSymbolName: string | null = null
  let currentStartLine = firstBoundaryLine >= 0 ? firstBoundaryLine + 1 : 1
  let currentParentClass: string | null = null

  const startIdx = firstBoundaryLine >= 0 ? firstBoundaryLine : 0

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    const boundary = matchBoundary(line, patterns, language!)

    if (boundary && currentChunkLines.length > 0) {
      // Emit previous chunk
      emitChunk(
        chunks,
        currentChunkLines,
        currentChunkType,
        currentSymbolName,
        currentStartLine
      )

      // Start new chunk
      currentChunkLines = [line]
      if (boundary.type === 'class') {
        currentParentClass = boundary.symbolName
        currentChunkType = 'class'
        currentSymbolName = boundary.symbolName
      } else {
        currentChunkType = 'function'
        // Prefix method name with parent class if available
        currentSymbolName =
          currentParentClass && boundary.symbolName
            ? `${currentParentClass}.${boundary.symbolName}`
            : boundary.symbolName
      }
      currentStartLine = i + 1 // 1-based
    } else if (boundary && currentChunkLines.length === 0) {
      // First boundary — start accumulating
      currentChunkLines = [line]
      if (boundary.type === 'class') {
        currentParentClass = boundary.symbolName
        currentChunkType = 'class'
        currentSymbolName = boundary.symbolName
      } else {
        currentChunkType = 'function'
        currentSymbolName =
          currentParentClass && boundary.symbolName
            ? `${currentParentClass}.${boundary.symbolName}`
            : boundary.symbolName
      }
      currentStartLine = i + 1
    } else {
      currentChunkLines.push(line)

      // Split oversized chunks at blank lines
      if (
        currentChunkLines.length > MAX_CHUNK_LINES &&
        line.trim() === ''
      ) {
        emitChunk(
          chunks,
          currentChunkLines,
          currentChunkType,
          currentSymbolName,
          currentStartLine
        )
        currentChunkLines = []
        currentChunkType = 'block'
        currentSymbolName = null
        currentStartLine = i + 2 // next line, 1-based
      }
    }
  }

  // Emit final chunk
  if (currentChunkLines.length > 0) {
    emitChunk(
      chunks,
      currentChunkLines,
      currentChunkType,
      currentSymbolName,
      currentStartLine
    )
  }

  return chunks
}

function emitChunk(
  chunks: Chunk[],
  lines: string[],
  chunkType: 'function' | 'class' | 'block',
  symbolName: string | null,
  startLine: number
): void {
  const content = lines.join('\n').trim()

  // Discard tiny chunks
  if (content.length < MIN_CHUNK_CHARS) return
  if (chunkType === 'block' && lines.length < MIN_BLOCK_LINES) return

  chunks.push({
    chunkType,
    symbolName,
    content,
    startLine,
    endLine: startLine + lines.length - 1,
  })
}

// ─── Markdown Chunker ────────────────────────────────────────────────────────

/**
 * Split markdown on `# ` and `## ` headers.
 * Each section becomes a "doc" chunk with the heading as symbolName.
 */
export function chunkMarkdown(content: string): Chunk[] {
  if (!content || content.trim().length === 0) return []

  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentLines: string[] = []
  let currentHeading: string | null = null
  let currentStartLine = 1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^#{1,2}\s+(.+)/)

    if (headingMatch) {
      // Emit previous section
      if (currentLines.length > 0) {
        const sectionContent = currentLines.join('\n').trim()
        if (sectionContent.length >= MIN_CHUNK_CHARS) {
          chunks.push({
            chunkType: 'doc',
            symbolName: currentHeading,
            content: sectionContent,
            startLine: currentStartLine,
            endLine: i, // previous line (0-based i = 1-based i)
          })
        }
      }
      currentLines = [line]
      currentHeading = headingMatch[1].trim()
      currentStartLine = i + 1
    } else {
      currentLines.push(line)
    }
  }

  // Emit final section
  if (currentLines.length > 0) {
    const sectionContent = currentLines.join('\n').trim()
    if (sectionContent.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunkType: 'doc',
        symbolName: currentHeading,
        content: sectionContent,
        startLine: currentStartLine,
        endLine: lines.length,
      })
    }
  }

  return chunks
}

// ─── Git History Chunker ─────────────────────────────────────────────────────

const COMMIT_LINE_RE = /^[0-9a-f]{7,}\s/

/**
 * Chunk git log output. Each commit line starts a new "commit" chunk.
 */
export function chunkGitHistory(content: string): Chunk[] {
  if (!content || content.trim().length === 0) return []

  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentLines: string[] = []
  let currentHash: string | null = null

  for (const line of lines) {
    if (COMMIT_LINE_RE.test(line)) {
      // Emit previous commit chunk
      if (currentLines.length > 0 && currentHash) {
        const commitContent = currentLines.join('\n').trim()
        if (commitContent.length >= MIN_CHUNK_CHARS) {
          chunks.push({
            chunkType: 'commit',
            symbolName: currentHash,
            content: commitContent,
            startLine: null,
            endLine: null,
          })
        }
      }
      currentHash = line.split(/\s/)[0]
      currentLines = [line]
    } else {
      currentLines.push(line)
    }
  }

  // Emit final commit
  if (currentLines.length > 0 && currentHash) {
    const commitContent = currentLines.join('\n').trim()
    if (commitContent.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunkType: 'commit',
        symbolName: currentHash,
        content: commitContent,
        startLine: null,
        endLine: null,
      })
    }
  }

  return chunks
}

// ─── Fallback Fixed-Size Chunker ─────────────────────────────────────────────

const FALLBACK_WINDOW = 50
const FALLBACK_OVERLAP = 10

/**
 * Fixed-size sliding window chunker for unknown languages.
 * 50-line windows with 10-line overlap.
 */
function chunkFallback(content: string): Chunk[] {
  if (!content || content.trim().length === 0) return []

  const lines = content.split('\n')
  const chunks: Chunk[] = []

  for (let i = 0; i < lines.length; i += FALLBACK_WINDOW - FALLBACK_OVERLAP) {
    const windowLines = lines.slice(i, i + FALLBACK_WINDOW)
    const chunkContent = windowLines.join('\n').trim()

    if (chunkContent.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunkType: 'block',
        symbolName: null,
        content: chunkContent,
        startLine: i + 1,
        endLine: Math.min(i + FALLBACK_WINDOW, lines.length),
      })
    }

    // Stop if we've reached the end
    if (i + FALLBACK_WINDOW >= lines.length) break
  }

  return chunks
}
