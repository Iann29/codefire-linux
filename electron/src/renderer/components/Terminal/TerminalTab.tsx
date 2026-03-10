import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalTabProps {
  /** Unique ID for this terminal session */
  terminalId: string
  /** Whether this tab is the focused/active one (tab bar highlight + keyboard focus) */
  isActive: boolean
  /** Whether this tab should be rendered (display: block). Defaults to isActive. */
  isVisible?: boolean
  /** Whether grid view is active — shows a focus ring on the active terminal */
  gridMode?: boolean
  /** Called when the user clicks this terminal (for grid mode focus switching) */
  onActivate?: () => void
}

/**
 * A single terminal tab backed by an xterm.js instance.
 *
 * - Sends keystrokes to main process via IPC `terminal:write`
 * - Receives PTY output via IPC `terminal:data`
 * - Auto-resizes via FitAddon + ResizeObserver
 * - Supports clickable URLs via WebLinksAddon
 */
export default function TerminalTab({ terminalId, isActive, isVisible, gridMode, onActivate }: TerminalTabProps) {
  const shouldShow = isVisible ?? isActive
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ─── Create xterm.js instance ─────────────────────────────────────────
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", "Menlo", "Monaco", "Cascadia Code", "Consolas", "Courier New", monospace',
      rightClickSelectsWord: true,
      allowProposedApi: true,
      theme: {
        background: '#171717',
        foreground: '#e5e5e5',
        cursor: '#b8adcf',
        cursorAccent: '#171717',
        selectionBackground: 'rgba(184, 173, 207, 0.3)',
        black: '#171717',
        red: '#ef4444',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#22d3ee',
        white: '#e5e5e5',
        brightBlack: '#525252',
        brightRed: '#f87171',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(container)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Initial fit
    try {
      fitAddon.fit()
    } catch {
      // Container may not be visible yet
    }

    // ─── Clipboard: Ctrl+Shift+C to copy, Ctrl+Shift+V to paste ──────────
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+C: copy selection
      if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        return false
      }
      // Ctrl+Shift+V: paste
      if (event.ctrlKey && event.shiftKey && event.key === 'V' && event.type === 'keydown') {
        navigator.clipboard.readText().then((text) => {
          window.api.send('terminal:write', terminalId, text)
        })
        return false
      }
      // Ctrl+C with selection: copy instead of sending SIGINT
      if (event.ctrlKey && !event.shiftKey && event.key === 'c' && event.type === 'keydown') {
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection())
          terminal.clearSelection()
          return false
        }
      }
      // Ctrl+V: paste
      if (event.ctrlKey && !event.shiftKey && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then((text) => {
          window.api.send('terminal:write', terminalId, text)
        })
        return false
      }
      return true
    })

    // ─── Keystrokes → main process ────────────────────────────────────────
    const onDataDisposable = terminal.onData((data) => {
      window.api.send('terminal:write', terminalId, data)
    })

    // ─── PTY output → xterm.js ────────────────────────────────────────────
    const removeDataListener = window.api.on(
      'terminal:data',
      (id: unknown, data: unknown) => {
        if (id === terminalId && typeof data === 'string') {
          terminal.write(data)
        }
      }
    )

    // ─── PTY exit ─────────────────────────────────────────────────────────
    const removeExitListener = window.api.on(
      'terminal:exit',
      (id: unknown, exitCode: unknown) => {
        if (id === terminalId) {
          terminal.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
        }
      }
    )

    // ─── Resize handling ──────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // Ignore errors during disposal
      }
    })
    resizeObserver.observe(container)

    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      window.api.send('terminal:resize', terminalId, cols, rows)
    })

    // ─── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      removeDataListener()
      removeExitListener()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId])

  // Re-fit when the tab becomes visible (it may have been resized while hidden)
  useEffect(() => {
    if (shouldShow && fitAddonRef.current) {
      // Small delay to allow layout to settle
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit()
        } catch {
          // Ignore
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [shouldShow])

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        display: shouldShow ? 'block' : 'none',
        backgroundColor: '#171717',
        ...(gridMode && isActive ? { boxShadow: 'inset 0 0 0 1px rgba(184,173,207,0.4)' } : {}),
      }}
      onMouseDown={() => {
        if (gridMode && !isActive && onActivate) onActivate()
      }}
    />
  )
}
