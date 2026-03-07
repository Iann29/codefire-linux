import { useState, useRef, useCallback, useEffect } from 'react'
import { Globe } from 'lucide-react'
import { useBrowserTabs } from '@renderer/hooks/useBrowserTabs'
import BrowserTabStrip from '@renderer/components/Browser/BrowserTabStrip'
import BrowserToolbar from '@renderer/components/Browser/BrowserToolbar'
import CaptureIssueSheet from '@renderer/components/Browser/CaptureIssueSheet'
import DevToolsPanel from '@renderer/components/Browser/DevToolsPanel'

interface BrowserViewProps {
  projectId: string
}

interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

export default function BrowserView({ projectId }: BrowserViewProps) {
  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updateTab,
    navigateTab,
  } = useBrowserTabs('about:blank')

  const webviewContainerRef = useRef<HTMLDivElement>(null)
  const webviewRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [showConsole, setShowConsole] = useState(false)
  const [showCaptureIssue, setShowCaptureIssue] = useState(false)
  const [captureScreenshot, setCaptureScreenshot] = useState<string | null>(null)

  // Resize webviews to match container using explicit pixel dimensions
  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    function syncSize() {
      const w = container!.clientWidth
      const h = container!.clientHeight
      for (const [, wv] of webviewRefs.current.entries()) {
        const el = wv as HTMLElement
        el.setAttribute('style', `display:inline-flex;width:${w}px;height:${h}px;border:none;`)
      }
    }

    const ro = new ResizeObserver(syncSize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Create/remove webviews when tabs change
  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    for (const tab of tabs) {
      // Don't create a webview for about:blank tabs (show placeholder instead)
      if (tab.url === 'about:blank') continue
      if (webviewRefs.current.has(tab.id)) continue

      const wv = document.createElement('webview') as any
      wv.setAttribute('src', tab.url)
      wv.setAttribute('allowpopups', 'true')
      wv.setAttribute('partition', 'persist:browser')
      const w = container.clientWidth
      const h = container.clientHeight
      const vis = tab.id === activeTabId ? 'inline-flex' : 'none'
      wv.setAttribute('style', `display:${vis};width:${w}px;height:${h}px;border:none;`)

      wv.addEventListener('page-title-updated', (e: any) => {
        updateTab(tab.id, { title: e.title })
      })
      wv.addEventListener('did-navigate', (e: any) => {
        updateTab(tab.id, { url: e.url })
      })
      wv.addEventListener('did-navigate-in-page', (e: any) => {
        if (e.isMainFrame) updateTab(tab.id, { url: e.url })
      })
      wv.addEventListener('did-start-loading', () => {
        updateTab(tab.id, { isLoading: true })
      })
      wv.addEventListener('did-stop-loading', () => {
        updateTab(tab.id, { isLoading: false })
        if (tab.id === activeTabId) {
          setCanGoBack(wv.canGoBack())
          setCanGoForward(wv.canGoForward())
        }
      })
      wv.addEventListener('did-fail-load', (e: any) => {
        if (e.errorCode !== -3) {
          updateTab(tab.id, {
            isLoading: false,
            title: `Error: ${e.errorDescription || 'Failed to load'}`,
          })
        }
      })
      wv.addEventListener('console-message', (e: any) => {
        setConsoleEntries((prev) => [
          ...prev.slice(-499),
          {
            level: ['verbose', 'info', 'warning', 'error'][e.level] ?? 'info',
            message: e.message,
            timestamp: Date.now(),
          },
        ])
      })

      container.appendChild(wv)
      webviewRefs.current.set(tab.id, wv)
    }

    // Remove webviews for closed tabs
    const tabIds = new Set(tabs.map((t) => t.id))
    for (const [id, wv] of webviewRefs.current.entries()) {
      if (!tabIds.has(id)) {
        wv.remove()
        webviewRefs.current.delete(id)
      }
    }
  }, [tabs, activeTabId, updateTab])

  // Show/hide webviews based on active tab
  useEffect(() => {
    const container = webviewContainerRef.current
    for (const [id, wv] of webviewRefs.current.entries()) {
      const el = wv as HTMLElement
      const w = container?.clientWidth ?? 0
      const h = container?.clientHeight ?? 0
      if (id === activeTabId) {
        el.setAttribute('style', `display:inline-flex;width:${w}px;height:${h}px;border:none;`)
      } else {
        el.setAttribute('style', `display:none;`)
      }
    }
    const activeWv = webviewRefs.current.get(activeTabId) as any
    if (activeWv && activeWv.canGoBack) {
      setCanGoBack(activeWv.canGoBack())
      setCanGoForward(activeWv.canGoForward())
    }
  }, [activeTabId])

  const getActiveWebview = useCallback(() => {
    return webviewRefs.current.get(activeTabId) as any
  }, [activeTabId])

  // Handle browser commands from the main process (legacy + direct bridge)
  useEffect(() => {
    async function executeCommand(tool: string, args: Record<string, unknown>) {
      const wv = webviewRefs.current.get(activeTabId) as any

      switch (tool) {
        case 'browser_navigate': {
          if (!wv) throw new Error('No active webview')
          const rawUrl = typeof args.url === 'string' ? args.url : ''
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Navigation timed out')), 45_000)
            const onStop = () => {
              clearTimeout(timeout)
              resolve()
            }
            wv.addEventListener('did-stop-loading', onStop, { once: true })
            wv.loadURL(rawUrl)
          })
          return { success: true, url: rawUrl }
        }
        case 'browser_snapshot': {
          if (!wv) throw new Error('No active webview')
          const html = await wv.executeJavaScript('document.documentElement.outerHTML')
          const maxSize = typeof args.max_size === 'number' ? args.max_size : 50_000
          return { html: String(html).slice(0, maxSize) }
        }
        case 'browser_screenshot': {
          if (!wv) throw new Error('No active webview')
          const img = await wv.capturePage()
          return { image: img.toDataURL() }
        }
        case 'browser_click': {
          if (!wv) throw new Error('No active webview')
          const ref = String(args.ref ?? '')
          const clickResult = await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-ref="${ref}"]');
              if (!el) return { error: 'Element not found with ref: ${ref}' };
              el.click();
              return { success: true };
            })()
          `)
          if (clickResult?.error) throw new Error(String(clickResult.error))
          return clickResult
        }
        case 'browser_type': {
          if (!wv) throw new Error('No active webview')
          const ref = String(args.ref ?? '')
          const text = typeof args.text === 'string' ? args.text : ''
          const typeResult = await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-ref="${ref}"]');
              if (!el) return { error: 'Element not found with ref: ${ref}' };
              const target = el;
              if ('value' in target) {
                target.value = ${JSON.stringify(text)};
              } else {
                target.textContent = ${JSON.stringify(text)};
              }
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true };
            })()
          `)
          if (typeResult?.error) throw new Error(String(typeResult.error))
          return typeResult
        }
        case 'browser_dom_map': {
          if (!wv) throw new Error('No active webview')
          const maxElements = typeof args.max_elements === 'number' ? Math.min(Math.max(args.max_elements, 50), 1000) : 500
          return await wv.executeJavaScript(`
            (() => {
              const selector = [
                'a[href]',
                'button',
                'input:not([type="hidden"])',
                'textarea',
                'select',
                '[role="button"]',
                '[role="link"]',
                '[role="checkbox"]',
                '[role="radio"]',
                '[role="switch"]',
                '[role="tab"]',
                '[role="menuitem"]',
                '[role="option"]',
                '[role="combobox"]',
                '[role="textbox"]',
                '[role="searchbox"]',
                '[tabindex]:not([tabindex="-1"])',
                '[onclick]',
                '[contenteditable]:not([contenteditable="false"])',
                'summary'
              ].join(',');

              const isVisible = (el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
              };

              const nodeText = (el) => {
                const aria = el.getAttribute('aria-label') || '';
                const title = el.getAttribute('title') || '';
                const placeholder = el.getAttribute('placeholder') || '';
                const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
                return [aria, title, placeholder, text].filter(Boolean).join(' ').slice(0, 100);
              };

              const nodes = Array.from(document.querySelectorAll(selector))
                .filter(isVisible)
                .slice(0, ${maxElements});

              const elements = nodes.map((el, idx) => {
                const index = idx + 1;
                el.setAttribute('data-cf-idx', String(index));
                const rect = el.getBoundingClientRect();
                const attributes = {};
                ['id', 'class', 'name', 'type', 'href', 'role', 'placeholder'].forEach((key) => {
                  const value = el.getAttribute(key);
                  if (value) attributes[key] = value.slice(0, 120);
                });
                const tagName = (el.tagName || '').toLowerCase();
                const interactiveType = el.getAttribute('role') || tagName;
                return {
                  index,
                  tagName,
                  interactiveType,
                  accessibleText: nodeText(el),
                  attributes,
                  visible: true,
                  rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                  },
                };
              });

              return {
                url: location.href,
                title: document.title,
                totalElements: elements.length,
                elements,
                formatted: elements.slice(0, 200).map((el) => {
                  const attrs = Object.entries(el.attributes).map(([k, v]) => k + '=' + v).join(', ');
                  return '[' + el.index + '] <' + el.tagName + '> "' + (el.accessibleText || '') + '"' + (attrs ? ' {' + attrs + '}' : '');
                }).join('\\n'),
              };
            })()
          `)
        }
        case 'browser_click_element': {
          if (!wv) throw new Error('No active webview')
          const index = Number(args.index)
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              el.scrollIntoView({ block: 'center', inline: 'center' });
              el.focus?.();
              el.click();
              return { success: true, index: ${index} };
            })()
          `)
        }
        case 'browser_type_element': {
          if (!wv) throw new Error('No active webview')
          const index = Number(args.index)
          const text = typeof args.text === 'string' ? args.text : ''
          const clearFirst = args.clearFirst !== false
          const pressEnter = args.pressEnter === true
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              el.scrollIntoView({ block: 'center', inline: 'center' });
              el.focus?.();
              const target = el;
              if (${clearFirst ? 'true' : 'false'}) {
                if ('value' in target) target.value = '';
                if (target.isContentEditable) target.textContent = '';
              }
              if ('value' in target) {
                target.value = ${JSON.stringify(text)};
              } else if (target.isContentEditable) {
                target.textContent = ${JSON.stringify(text)};
              }
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              if (${pressEnter ? 'true' : 'false'}) {
                const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
                target.dispatchEvent(evt);
              }
              return { success: true, index: ${index}, typed: ${JSON.stringify(text.length)} };
            })()
          `)
        }
        case 'browser_select_element': {
          if (!wv) throw new Error('No active webview')
          const index = Number(args.index)
          const value = typeof args.value === 'string' ? args.value : ''
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              if (el.tagName.toLowerCase() !== 'select') {
                return { error: 'Element ' + ${index} + ' is not a <select>.' };
              }
              const select = el;
              const hasValue = Array.from(select.options).some((opt) => opt.value === ${JSON.stringify(value)});
              if (!hasValue) {
                return { error: 'Option value not found: ' + ${JSON.stringify(value)} };
              }
              select.value = ${JSON.stringify(value)};
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, index: ${index}, value: ${JSON.stringify(value)} };
            })()
          `)
        }
        case 'browser_hover_element': {
          if (!wv) throw new Error('No active webview')
          const index = Number(args.index)
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              el.scrollIntoView({ block: 'center', inline: 'center' });
              const rect = el.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              const over = new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y });
              const move = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y });
              el.dispatchEvent(over);
              el.dispatchEvent(move);
              return { success: true, index: ${index} };
            })()
          `)
        }
        case 'browser_scroll_to_element': {
          if (!wv) throw new Error('No active webview')
          const index = Number(args.index)
          const block = typeof args.block === 'string' ? args.block : 'center'
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              el.scrollIntoView({ block: ${JSON.stringify(block)}, inline: 'nearest', behavior: 'smooth' });
              const rect = el.getBoundingClientRect();
              return { success: true, index: ${index}, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
            })()
          `)
        }
        case 'browser_get_element_info': {
          if (!wv) throw new Error('No active webview')
          const index = Number(args.index)
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              const rect = el.getBoundingClientRect();
              return {
                index: ${index},
                tagName: (el.tagName || '').toLowerCase(),
                text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
                html: el.outerHTML.slice(0, 1000),
                rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
              };
            })()
          `)
        }
        case 'browser_eval': {
          if (!wv) throw new Error('No active webview')
          const expression = typeof args.expression === 'string'
            ? args.expression
            : typeof args.code === 'string'
              ? args.code
              : ''
          const evalResult = await wv.executeJavaScript(expression)
          return { value: evalResult }
        }
        case 'browser_console_logs':
          return { entries: consoleEntries }
        default:
          throw new Error(`Unsupported browser command: ${tool}`)
      }
    }

    async function dispatchResult(resultChannel: string, tool: string, args: Record<string, unknown>) {
      try {
        const result = await executeCommand(tool, args)
        if (result && typeof result === 'object' && 'error' in result) {
          window.api.send(resultChannel, { error: String((result as { error: unknown }).error) })
          return
        }
        window.api.send(resultChannel, result)
      } catch (err: any) {
        window.api.send(resultChannel, { error: err.message || String(err) })
      }
    }

    const legacyCleanup = window.api.on('browser:commandRequest', (data: any) => {
      const id = String(data?.id ?? '')
      const tool = String(data?.tool ?? '')
      const args = (data?.args ?? {}) as Record<string, unknown>
      void dispatchResult(`browser:commandResult:${id}`, tool, args)
    })

    const bridgeCleanup = window.api.on('browser:execute', (data: any) => {
      const requestId = String(data?.requestId ?? '')
      const tool = String(data?.tool ?? '')
      const args = (data?.args ?? {}) as Record<string, unknown>
      void dispatchResult(`browser:result:${requestId}`, tool, args)
    })

    return () => {
      legacyCleanup()
      bridgeCleanup()
    }
  }, [activeTabId, consoleEntries])

  function handleNavigate(url: string) {
    // Normalize URL
    let normalized = url.trim()
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://') && !normalized.startsWith('about:')) {
      if (normalized.includes('.') && !normalized.includes(' ')) {
        normalized = `https://${normalized}`
      } else {
        normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`
      }
    }

    navigateTab(activeTabId, normalized)

    const wv = getActiveWebview()
    if (wv) {
      wv.loadURL(normalized)
    }
    // If no webview exists yet (was about:blank), the useEffect will create one
    // since we just updated the tab URL away from about:blank
  }

  function handleScreenshot() {
    const wv = getActiveWebview()
    if (wv && wv.capturePage) {
      wv.capturePage().then((img: any) => {
        const dataUrl = img.toDataURL()
        const w = window.open('')
        if (w) {
          w.document.write(`<img src="${dataUrl}" style="max-width:100%">`)
        }
      })
    }
  }

  function handleCaptureIssue() {
    const wv = getActiveWebview()
    if (wv && wv.capturePage) {
      wv.capturePage().then((img: any) => {
        setCaptureScreenshot(img.toDataURL())
        setShowCaptureIssue(true)
      })
    } else {
      setCaptureScreenshot(null)
      setShowCaptureIssue(true)
    }
  }

  const hasWebview = activeTab.url !== 'about:blank' && webviewRefs.current.has(activeTabId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
      <BrowserTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onAdd={() => addTab()}
      />

      <BrowserToolbar
        url={activeTab.url === 'about:blank' ? '' : activeTab.url}
        onNavigate={handleNavigate}
        onBack={() => getActiveWebview()?.goBack()}
        onForward={() => getActiveWebview()?.goForward()}
        onReload={() => getActiveWebview()?.reload()}
        onScreenshot={handleScreenshot}
        onCaptureIssue={handleCaptureIssue}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />

      {/* Webview container */}
      <div
        ref={webviewContainerRef}
        className="flex-1 min-h-0 overflow-hidden relative"
      >
        {/* Placeholder shown when no page is loaded */}
        {!hasWebview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900">
            <Globe size={32} className="text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-600">Enter a URL to get started</p>
          </div>
        )}
      </div>

      {/* DevTools panel (Console, Network, Elements) */}
      {showConsole && (
        <DevToolsPanel
          consoleEntries={consoleEntries}
          onClearConsole={() => setConsoleEntries([])}
          getActiveWebview={getActiveWebview}
        />
      )}

      {/* Console toggle footer */}
      <div className="flex items-center px-3 py-1 border-t border-neutral-800 bg-neutral-900 shrink-0">
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          className="text-[10px] text-neutral-600 hover:text-codefire-orange transition-colors"
        >
          {showConsole ? 'Hide DevTools' : 'Show DevTools'}
        </button>
      </div>

      {/* Capture Issue Sheet */}
      {showCaptureIssue && (
        <CaptureIssueSheet
          projectId={projectId}
          screenshotDataUrl={captureScreenshot}
          pageUrl={activeTab.url}
          pageTitle={activeTab.title || activeTab.url}
          consoleEntries={consoleEntries}
          onClose={() => setShowCaptureIssue(false)}
        />
      )}
    </div>
  )
}
