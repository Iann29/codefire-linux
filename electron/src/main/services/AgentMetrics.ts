/**
 * In-memory metrics collector for AgentService tool calls and runs.
 * Tracks per-tool latency, error/timeout counts, and overall run statistics.
 * Retains data for the last 100 runs (older entries are discarded).
 *
 * Phase 6 enhancements:
 * - Per-call detailed records within each run (name, latency, category, sizes)
 * - Enhanced RunRecord with derived counters (fullFileRead, semantic, bridge, stale, escape)
 * - `recordToolCallDetailed` for richer telemetry while keeping backward compat
 * - `getDerivedMetrics()` for aggregate adoption/block rates
 */

import type { ToolCategory } from './tools/ToolContracts'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface ToolStats {
  count: number
  errorCount: number
  timeoutCount: number
  totalMs: number
  minMs: number
  maxMs: number
}

/** Individual tool call record stored within a run. */
interface ToolCallRecord {
  name: string
  durationMs: number
  status: 'done' | 'error' | 'timeout'
  category: ToolCategory | null
  payloadSize: number
  resultSize: number
  /** Whether the error contained a stale-write indicator. */
  staleWriteBlock: boolean
  /** Whether the error contained a path-escape indicator. */
  pathEscapeBlock: boolean
}

interface RunRecord {
  startedAt: number
  endedAt: number
  durationMs: number
  toolCallCount: number
  /** Detailed per-call records for this run (Phase 6). */
  toolCalls: ToolCallRecord[]
  /** Count of 'read_file' calls in this run. */
  fullFileReadCount: number
  /** Count of tools with category 'codebase'. */
  semanticToolCallCount: number
  /** Count of tools with category 'web-project'. */
  bridgeToolCallCount: number
  /** Count of errors containing stale-write indicators. */
  staleWriteBlockCount: number
  /** Count of errors containing path-escape indicators. */
  pathEscapeBlockCount: number
}

export interface DerivedMetrics {
  avgToolCallsPerTask: number
  avgFullFileReadsPerTask: number
  /** Percentage (0-100) of runs that used at least one semantic (codebase) tool. */
  semanticToolAdoptionRate: number
  /** Percentage (0-100) of runs that used at least one bridge (web-project) tool. */
  bridgeToolAdoptionRate: number
  /** Total stale-write blocks across all retained runs. */
  staleWriteBlockCount: number
  /** Total path-escape blocks across all retained runs. */
  pathEscapeBlockCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RUNS = 100

/** Patterns that indicate a stale-write block in an error/result string. */
const STALE_WRITE_PATTERNS = ['CHECKSUM_MISMATCH', 'stale']

/** Patterns that indicate a path-escape block in an error/result string. */
const PATH_ESCAPE_PATTERNS = ['ESCAPE', 'outside project']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase()
  return patterns.some((p) => lower.includes(p.toLowerCase()))
}

// ---------------------------------------------------------------------------
// AgentMetrics
// ---------------------------------------------------------------------------

export class AgentMetrics {
  private toolMap = new Map<string, ToolStats>()
  private runs: RunRecord[] = []
  private currentRunStart: number | null = null
  private currentRunToolCalls = 0
  /** Detailed call records accumulated during the current run. */
  private currentRunCallRecords: ToolCallRecord[] = []

  // -------------------------------------------------------------------------
  // Recording — backward-compatible
  // -------------------------------------------------------------------------

  /**
   * Record a single tool call with its duration and outcome.
   * Backward-compatible: does NOT require category/size params.
   */
  recordToolCall(name: string, durationMs: number, status: 'done' | 'error' | 'timeout'): void {
    this.updateToolMap(name, durationMs, status)
    this.currentRunToolCalls++

    // Store a minimal detailed record so RunRecord counters stay consistent
    this.currentRunCallRecords.push({
      name,
      durationMs,
      status,
      category: null,
      payloadSize: 0,
      resultSize: 0,
      staleWriteBlock: false,
      pathEscapeBlock: false,
    })
  }

  // -------------------------------------------------------------------------
  // Recording — Phase 6 detailed
  // -------------------------------------------------------------------------

  /**
   * Record a tool call with full Phase 6 telemetry data.
   *
   * @param name        Tool name (e.g. 'read_file')
   * @param durationMs  Wall-clock latency of the call
   * @param status      Outcome
   * @param category    ToolCategory from the tool definition
   * @param payloadSize Size of serialised arguments in bytes
   * @param resultSize  Size of the result payload in bytes
   * @param resultContent Optional stringified result/error for pattern detection
   */
  recordToolCallDetailed(
    name: string,
    durationMs: number,
    status: 'done' | 'error' | 'timeout',
    category: ToolCategory | null,
    payloadSize: number,
    resultSize: number,
    resultContent?: string,
  ): void {
    this.updateToolMap(name, durationMs, status)
    this.currentRunToolCalls++

    const staleWriteBlock =
      status === 'error' && resultContent != null && containsAny(resultContent, STALE_WRITE_PATTERNS)
    const pathEscapeBlock =
      status === 'error' && resultContent != null && containsAny(resultContent, PATH_ESCAPE_PATTERNS)

    this.currentRunCallRecords.push({
      name,
      durationMs,
      status,
      category,
      payloadSize,
      resultSize,
      staleWriteBlock,
      pathEscapeBlock,
    })
  }

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  /**
   * Mark the beginning of a new agent run.
   */
  recordRunStart(): void {
    this.currentRunStart = Date.now()
    this.currentRunToolCalls = 0
    this.currentRunCallRecords = []
  }

  /**
   * Mark the end of the current agent run and store the record.
   */
  recordRunEnd(): void {
    const start = this.currentRunStart
    if (start === null) return

    const now = Date.now()
    const calls = this.currentRunCallRecords

    // Derive per-run counters from the detailed call records
    let fullFileReadCount = 0
    let semanticToolCallCount = 0
    let bridgeToolCallCount = 0
    let staleWriteBlockCount = 0
    let pathEscapeBlockCount = 0

    for (const call of calls) {
      if (call.name === 'read_file') fullFileReadCount++
      if (call.category === 'codebase') semanticToolCallCount++
      if (call.category === 'web-project') bridgeToolCallCount++
      if (call.staleWriteBlock) staleWriteBlockCount++
      if (call.pathEscapeBlock) pathEscapeBlockCount++
    }

    this.runs.push({
      startedAt: start,
      endedAt: now,
      durationMs: now - start,
      toolCallCount: this.currentRunToolCalls,
      toolCalls: calls,
      fullFileReadCount,
      semanticToolCallCount,
      bridgeToolCallCount,
      staleWriteBlockCount,
      pathEscapeBlockCount,
    })

    // Keep only the last MAX_RUNS entries
    if (this.runs.length > MAX_RUNS) {
      this.runs = this.runs.slice(this.runs.length - MAX_RUNS)
    }

    this.currentRunStart = null
    this.currentRunToolCalls = 0
    this.currentRunCallRecords = []
  }

  // -------------------------------------------------------------------------
  // Queries — original API
  // -------------------------------------------------------------------------

  /**
   * Return per-tool statistics.
   */
  getToolStats(): Record<
    string,
    { count: number; errorCount: number; timeoutCount: number; avgMs: number; minMs: number; maxMs: number }
  > {
    const result: Record<
      string,
      { count: number; errorCount: number; timeoutCount: number; avgMs: number; minMs: number; maxMs: number }
    > = {}

    for (const [name, stats] of this.toolMap) {
      result[name] = {
        count: stats.count,
        errorCount: stats.errorCount,
        timeoutCount: stats.timeoutCount,
        avgMs: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
        minMs: stats.minMs === Infinity ? 0 : stats.minMs,
        maxMs: stats.maxMs,
      }
    }

    return result
  }

  /**
   * Return aggregate run statistics.
   */
  getRunStats(): { totalRuns: number; avgDurationMs: number; avgToolCallsPerRun: number } {
    const total = this.runs.length
    if (total === 0) {
      return { totalRuns: 0, avgDurationMs: 0, avgToolCallsPerRun: 0 }
    }

    const sumDuration = this.runs.reduce((acc, r) => acc + r.durationMs, 0)
    const sumToolCalls = this.runs.reduce((acc, r) => acc + r.toolCallCount, 0)

    return {
      totalRuns: total,
      avgDurationMs: Math.round(sumDuration / total),
      avgToolCallsPerRun: Math.round((sumToolCalls / total) * 100) / 100,
    }
  }

  // -------------------------------------------------------------------------
  // Queries — Phase 6
  // -------------------------------------------------------------------------

  /**
   * Return derived aggregate metrics across all retained runs.
   */
  getDerivedMetrics(): DerivedMetrics {
    const total = this.runs.length
    if (total === 0) {
      return {
        avgToolCallsPerTask: 0,
        avgFullFileReadsPerTask: 0,
        semanticToolAdoptionRate: 0,
        bridgeToolAdoptionRate: 0,
        staleWriteBlockCount: 0,
        pathEscapeBlockCount: 0,
      }
    }

    let sumToolCalls = 0
    let sumFullFileReads = 0
    let runsWithSemantic = 0
    let runsWithBridge = 0
    let totalStaleBlocks = 0
    let totalEscapeBlocks = 0

    for (const run of this.runs) {
      sumToolCalls += run.toolCallCount
      sumFullFileReads += run.fullFileReadCount
      if (run.semanticToolCallCount > 0) runsWithSemantic++
      if (run.bridgeToolCallCount > 0) runsWithBridge++
      totalStaleBlocks += run.staleWriteBlockCount
      totalEscapeBlocks += run.pathEscapeBlockCount
    }

    return {
      avgToolCallsPerTask: Math.round((sumToolCalls / total) * 100) / 100,
      avgFullFileReadsPerTask: Math.round((sumFullFileReads / total) * 100) / 100,
      semanticToolAdoptionRate: Math.round((runsWithSemantic / total) * 10000) / 100,
      bridgeToolAdoptionRate: Math.round((runsWithBridge / total) * 10000) / 100,
      staleWriteBlockCount: totalStaleBlocks,
      pathEscapeBlockCount: totalEscapeBlocks,
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Reset all collected metrics.
   */
  reset(): void {
    this.toolMap.clear()
    this.runs = []
    this.currentRunStart = null
    this.currentRunToolCalls = 0
    this.currentRunCallRecords = []
  }

  /**
   * Return a JSON-serializable snapshot of all metrics.
   */
  toJSON(): object {
    return {
      tools: this.getToolStats(),
      runs: this.getRunStats(),
      derived: this.getDerivedMetrics(),
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private updateToolMap(name: string, durationMs: number, status: 'done' | 'error' | 'timeout'): void {
    let stats = this.toolMap.get(name)
    if (!stats) {
      stats = { count: 0, errorCount: 0, timeoutCount: 0, totalMs: 0, minMs: Infinity, maxMs: 0 }
      this.toolMap.set(name, stats)
    }

    stats.count++
    stats.totalMs += durationMs
    if (durationMs < stats.minMs) stats.minMs = durationMs
    if (durationMs > stats.maxMs) stats.maxMs = durationMs

    if (status === 'error') stats.errorCount++
    if (status === 'timeout') stats.timeoutCount++
  }
}
