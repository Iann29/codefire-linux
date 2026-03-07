/**
 * In-memory metrics collector for AgentService tool calls and runs.
 * Tracks per-tool latency, error/timeout counts, and overall run statistics.
 * Retains data for the last 100 runs (older entries are discarded).
 */

interface ToolStats {
  count: number
  errorCount: number
  timeoutCount: number
  totalMs: number
  minMs: number
  maxMs: number
}

interface RunRecord {
  startedAt: number
  endedAt: number
  durationMs: number
  toolCallCount: number
}

const MAX_RUNS = 100

export class AgentMetrics {
  private toolMap = new Map<string, ToolStats>()
  private runs: RunRecord[] = []
  private currentRunStart: number | null = null
  private currentRunToolCalls = 0

  /**
   * Record a single tool call with its duration and outcome.
   */
  recordToolCall(name: string, durationMs: number, status: 'done' | 'error' | 'timeout'): void {
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

    this.currentRunToolCalls++
  }

  /**
   * Mark the beginning of a new agent run.
   */
  recordRunStart(): void {
    this.currentRunStart = Date.now()
    this.currentRunToolCalls = 0
  }

  /**
   * Mark the end of the current agent run and store the record.
   */
  recordRunEnd(): void {
    const start = this.currentRunStart
    if (start === null) return

    const now = Date.now()
    this.runs.push({
      startedAt: start,
      endedAt: now,
      durationMs: now - start,
      toolCallCount: this.currentRunToolCalls,
    })

    // Keep only the last MAX_RUNS entries
    if (this.runs.length > MAX_RUNS) {
      this.runs = this.runs.slice(this.runs.length - MAX_RUNS)
    }

    this.currentRunStart = null
    this.currentRunToolCalls = 0
  }

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

  /**
   * Reset all collected metrics.
   */
  reset(): void {
    this.toolMap.clear()
    this.runs = []
    this.currentRunStart = null
    this.currentRunToolCalls = 0
  }

  /**
   * Return a JSON-serializable snapshot of all metrics.
   */
  toJSON(): object {
    return {
      tools: this.getToolStats(),
      runs: this.getRunStats(),
    }
  }
}
