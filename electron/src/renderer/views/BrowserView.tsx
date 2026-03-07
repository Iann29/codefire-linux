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
    // ─── Nuclear interaction scripts (injected into webview) ─────────
    function nuclearClickScript(index: number): string {
      return `(async () => {
        const INDEX = ${index};
        const el = document.querySelector('[data-cf-idx="' + INDEX + '"]');
        if (!el) return { error: 'Element not found for index ' + INDEX + '. Call browser_dom_map again.' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise(r => setTimeout(r, 100));
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const attempts = [];
        function s1(t) { const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }; t.dispatchEvent(new PointerEvent('pointerdown', o)); t.dispatchEvent(new MouseEvent('mousedown', o)); t.focus?.(); t.dispatchEvent(new PointerEvent('pointerup', o)); t.dispatchEvent(new MouseEvent('mouseup', o)); t.dispatchEvent(new MouseEvent('click', o)); return true; }
        function s2(t) { t.click(); return true; }
        function s3() { const rt = document.elementFromPoint(x, y); if (!rt || rt === el) return false; const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }; rt.dispatchEvent(new PointerEvent('pointerdown', o)); rt.dispatchEvent(new MouseEvent('mousedown', o)); rt.focus?.(); rt.dispatchEvent(new PointerEvent('pointerup', o)); rt.dispatchEvent(new MouseEvent('mouseup', o)); rt.dispatchEvent(new MouseEvent('click', o)); return true; }
        function s5(t) { const tags = ['A','BUTTON','INPUT','SELECT','TEXTAREA','LABEL','SUMMARY']; let c = t; while (c && c !== document.body) { if (tags.includes(c.tagName) || c.getAttribute('role') === 'button' || c.getAttribute('tabindex') !== null || c.onclick) { c.click(); return true; } c = c.parentElement; } return false; }
        const strats = [{ n:'pointerChain', f:()=>s1(el) }, { n:'nativeClick', f:()=>s2(el) }, { n:'elementFromPoint', f:()=>s3() }, { n:'interactiveAncestor', f:()=>s5(el) }];
        let success = false; let used = '';
        for (const { n, f } of strats) { try { const r = f(); attempts.push({ method: n, success: r }); if (r) { success = true; used = n; break; } } catch (e) { attempts.push({ method: n, success: false, error: e.message }); } }
        return { success, index: INDEX, strategy: used, coordinates: { x: Math.round(x), y: Math.round(y) }, attempts };
      })()`
    }

    function nuclearTypeScript(index: number, text: string, clearFirst: boolean, pressEnter: boolean, charDelay: number, strategy: string): string {
      return `(async () => {
        const TEXT = ${JSON.stringify(text)};
        const INDEX = ${index};
        const CLEAR = ${clearFirst};
        const ENTER = ${pressEnter};
        const DELAY = ${charDelay};
        const STRAT = ${JSON.stringify(strategy)};
        const el = document.querySelector('[data-cf-idx="' + INDEX + '"]');
        if (!el) return { error: 'Element not found for index ' + INDEX + '. Call browser_dom_map again.' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const attempts = [];
        function detectFw(t) { if (t.closest('[data-contents]') || t.closest('.DraftEditor-root')) return 'draftjs'; if (t.closest('[data-lexical-editor]')) return 'lexical'; if (t.closest('.ProseMirror')) return 'prosemirror'; if (t.closest('[data-slate-editor]')) return 'slate'; if (t.closest('.ql-editor')) return 'quill'; if (t.closest('.ck-editor__editable')) return 'ckeditor'; if (t.closest('.cm-editor') || t.closest('.CodeMirror')) return 'codemirror'; if (t.closest('.monaco-editor')) return 'monaco'; return null; }
        function findEdit(t) { if (t.isContentEditable) return t; if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return t; const e = t.querySelector('[contenteditable="true"]'); if (e) return e; const i = t.querySelector('input, textarea'); if (i) return i; return t; }
        function activate(t) { const r = t.getBoundingClientRect(); const cx = r.left + r.width/2; const cy = r.top + r.height/2; t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy })); t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy })); t.focus(); if (t.isContentEditable) { const s = window.getSelection(); const rg = document.createRange(); rg.selectNodeContents(t); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); } else if ('setSelectionRange' in t) { const l = t.value ? t.value.length : 0; t.setSelectionRange(l, l); } }
        function clearCont(t) { if ('value' in t && t.tagName !== 'DIV') { const p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const ns = Object.getOwnPropertyDescriptor(p, 'value'); if (ns && ns.set) { ns.set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); } else { t.value = ''; } } else if (t.isContentEditable) { const s = window.getSelection(); s.selectAllChildren(t); document.execCommand('delete', false); if (t.textContent && t.textContent.length > 0) t.textContent = ''; } }
        async function sKeyboard(t, txt) { for (let i = 0; i < txt.length; i++) { const c = txt[i]; t.dispatchEvent(new KeyboardEvent('keydown', { key: c, bubbles: true })); t.dispatchEvent(new InputEvent('beforeinput', { data: c, inputType: 'insertText', bubbles: true })); t.dispatchEvent(new InputEvent('input', { data: c, inputType: 'insertText', bubbles: true })); t.dispatchEvent(new KeyboardEvent('keyup', { key: c, bubbles: true })); if (DELAY > 0 && i < txt.length - 1) await new Promise(r => setTimeout(r, DELAY + Math.random() * 10)); } return true; }
        function sExec(t, txt) { return document.execCommand('insertText', false, txt); }
        function sInput(t, txt) { t.dispatchEvent(new InputEvent('beforeinput', { data: txt, inputType: 'insertText', bubbles: true, cancelable: true })); t.dispatchEvent(new InputEvent('input', { data: txt, inputType: 'insertText', bubbles: true })); return true; }
        function sClip(t, txt) { const cd = new DataTransfer(); cd.setData('text/plain', txt); t.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: cd })); return true; }
        function sNative(t, txt) { const p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const ns = Object.getOwnPropertyDescriptor(p, 'value'); if (ns && ns.set) { ns.set.call(t, (t.value || '') + txt); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); return true; } return false; }
        function sDirect(t, txt) { if ('value' in t && t.tagName !== 'DIV') { t.value = (t.value || '') + txt; } else if (t.isContentEditable) { const tn = document.createTextNode(txt); const s = window.getSelection(); if (s.rangeCount > 0) { const rg = s.getRangeAt(0); rg.deleteContents(); rg.insertNode(tn); rg.setStartAfter(tn); s.removeAllRanges(); s.addRange(rg); } else { t.appendChild(tn); } } t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        function verify(t, exp) { let a = ''; if ('value' in t && t.tagName !== 'DIV') a = t.value || ''; else if (t.isContentEditable) a = t.textContent || ''; a = a.replace(/[\\u200B\\uFEFF\\u00AD]/g, ''); const e = exp.replace(/[\\u200B\\uFEFF\\u00AD]/g, ''); if (a.includes(e)) return { verified: true, method: 'exact' }; const na = a.toLowerCase().replace(/\\s+/g, ' ').trim(); const ne = e.toLowerCase().replace(/\\s+/g, ' ').trim(); if (na.includes(ne)) return { verified: true, method: 'normalized' }; return { verified: false }; }
        const target = findEdit(el);
        const fw = detectFw(target);
        activate(target);
        if (CLEAR) { clearCont(target); await new Promise(r => setTimeout(r, 50)); }
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        let order;
        if (STRAT !== 'auto') { order = [STRAT]; }
        else if (isInput) { order = ['nativeSetter', 'keyboard', 'direct']; }
        else if (fw === 'draftjs' || fw === 'quill' || fw === 'ckeditor') { order = ['execCommand', 'keyboard', 'clipboard', 'direct']; }
        else if (fw === 'lexical' || fw === 'prosemirror') { order = ['inputEvent', 'execCommand', 'keyboard', 'clipboard', 'direct']; }
        else if (fw === 'slate') { order = ['inputEvent', 'clipboard', 'keyboard', 'direct']; }
        else if (fw === 'codemirror' || fw === 'monaco') { order = ['keyboard', 'clipboard', 'direct']; }
        else { order = ['execCommand', 'inputEvent', 'nativeSetter', 'keyboard', 'clipboard', 'direct']; }
        let success = false; let used = '';
        for (const s of order) {
          try { let r = false;
            switch(s) { case 'keyboard': r = await sKeyboard(target, TEXT); break; case 'execCommand': r = sExec(target, TEXT); break; case 'inputEvent': r = sInput(target, TEXT); break; case 'clipboard': r = sClip(target, TEXT); break; case 'nativeSetter': r = sNative(target, TEXT); break; case 'direct': r = sDirect(target, TEXT); break; }
            attempts.push({ strategy: s, result: r });
            if (r) { await new Promise(r => setTimeout(r, 50)); const v = verify(target, TEXT); attempts[attempts.length-1].verification = v; if (v.verified) { success = true; used = s; break; } }
          } catch (e) { attempts.push({ strategy: s, error: e.message }); }
        }
        if (ENTER) { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); }
        return { success, index: INDEX, strategy: used || 'none', framework: fw || 'unknown', attempts, textLength: TEXT.length };
      })()`
    }

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
          // Try simple click first; on failure, fall back to nuclear click
          const clickResult = await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${index}"]');
              if (!el) return { error: 'Element not found for index ${index}. Call browser_dom_map again.' };
              el.scrollIntoView({ block: 'center', inline: 'center' });
              el.focus?.();
              el.click();
              return { success: true, index: ${index} };
            })()
          `)
          return clickResult
        }
        case 'browser_nuclear_click': {
          if (!wv) throw new Error('No active webview')
          const nci = Number(args.index)
          return await wv.executeJavaScript(nuclearClickScript(nci))
        }
        case 'browser_type_element': {
          if (!wv) throw new Error('No active webview')
          const tIndex = Number(args.index)
          const tText = typeof args.text === 'string' ? args.text : ''
          const tClearFirst = args.clearFirst !== false
          const tPressEnter = args.pressEnter === true
          return await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector('[data-cf-idx="${tIndex}"]');
              if (!el) return { error: 'Element not found for index ${tIndex}. Call browser_dom_map again.' };
              el.scrollIntoView({ block: 'center', inline: 'center' });
              el.focus?.();
              const target = el;
              if (${tClearFirst ? 'true' : 'false'}) {
                if ('value' in target) target.value = '';
                if (target.isContentEditable) target.textContent = '';
              }
              if ('value' in target) {
                target.value = ${JSON.stringify(tText)};
              } else if (target.isContentEditable) {
                target.textContent = ${JSON.stringify(tText)};
              }
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(tText)} }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              if (${tPressEnter ? 'true' : 'false'}) {
                const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
                target.dispatchEvent(evt);
              }
              return { success: true, index: ${tIndex}, typed: ${JSON.stringify(tText.length)} };
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
        case 'browser_wait_element': {
          if (!wv) throw new Error('No active webview')
          const sel = typeof args.selector === 'string' ? args.selector : ''
          const state = typeof args.state === 'string' ? args.state : 'visible'
          const timeoutMs = typeof args.timeout === 'number' ? args.timeout : 5000
          return await wv.executeJavaScript(`
            (() => {
              return new Promise((resolve) => {
                const start = Date.now();
                const check = () => {
                  const el = document.querySelector(${JSON.stringify(sel)});
                  const state = ${JSON.stringify(state)};
                  let found = false;
                  if (state === 'attached') found = !!el;
                  else if (state === 'detached') found = !el;
                  else if (state === 'visible') {
                    if (el) {
                      const r = el.getBoundingClientRect();
                      const s = window.getComputedStyle(el);
                      found = s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
                    }
                  } else if (state === 'hidden') {
                    if (!el) found = true;
                    else {
                      const r = el.getBoundingClientRect();
                      const s = window.getComputedStyle(el);
                      found = s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0;
                    }
                  }
                  if (found) return resolve({ success: true, elapsed: Date.now() - start });
                  if (Date.now() - start > ${timeoutMs}) return resolve({ error: 'Timeout waiting for element', selector: ${JSON.stringify(sel)}, state: ${JSON.stringify(state)} });
                  setTimeout(check, 150);
                };
                check();
              });
            })()
          `)
        }
        case 'browser_wait_navigation': {
          if (!wv) throw new Error('No active webview')
          const strategy = typeof args.strategy === 'string' ? args.strategy : 'load'
          const navTimeout = typeof args.timeout === 'number' ? args.timeout : 10000
          if (strategy === 'urlchange') {
            const currentUrl = await wv.executeJavaScript('location.href')
            return await new Promise<Record<string, unknown>>((resolve) => {
              const timer = setTimeout(() => resolve({ error: 'Timeout waiting for URL change' }), navTimeout)
              const check = setInterval(async () => {
                try {
                  const newUrl = await wv.executeJavaScript('location.href')
                  if (newUrl !== currentUrl) {
                    clearInterval(check)
                    clearTimeout(timer)
                    resolve({ success: true, url: newUrl })
                  }
                } catch { /* webview busy */ }
              }, 200)
            })
          }
          // load or networkidle — wait for did-stop-loading
          return await new Promise<Record<string, unknown>>((resolve) => {
            const timer = setTimeout(() => resolve({ error: 'Timeout waiting for navigation' }), navTimeout)
            wv.addEventListener('did-stop-loading', () => {
              clearTimeout(timer)
              resolve({ success: true })
            }, { once: true })
          })
        }
        case 'browser_get_content': {
          if (!wv) throw new Error('No active webview')
          const mode = typeof args.mode === 'string' ? args.mode : 'text'
          return await wv.executeJavaScript(`
            (() => {
              const mode = ${JSON.stringify(mode)};
              if (mode === 'url') return { url: location.href, title: document.title };
              if (mode === 'title') return { title: document.title };
              if (mode === 'html') return { html: document.documentElement.outerHTML.slice(0, 50000) };
              if (mode === 'links') {
                return { links: Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(a => ({ text: a.textContent?.trim().slice(0, 80) || '', href: a.href })) };
              }
              if (mode === 'meta') {
                const metas = {};
                document.querySelectorAll('meta[name],meta[property]').forEach(m => {
                  const key = m.getAttribute('name') || m.getAttribute('property');
                  if (key) metas[key] = m.getAttribute('content') || '';
                });
                return { url: location.href, title: document.title, meta: metas };
              }
              // default: text
              return { text: document.body?.innerText?.slice(0, 20000) || '', url: location.href, title: document.title };
            })()
          `)
        }
        case 'browser_press_key': {
          if (!wv) throw new Error('No active webview')
          const key = typeof args.key === 'string' ? args.key : ''
          const modifiers = Array.isArray(args.modifiers) ? args.modifiers as string[] : []
          return await wv.executeJavaScript(`
            (() => {
              const key = ${JSON.stringify(key)};
              const mods = ${JSON.stringify(modifiers)};
              const opts = {
                key,
                code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
                bubbles: true,
                cancelable: true,
                ctrlKey: mods.includes('Control') || mods.includes('Ctrl'),
                shiftKey: mods.includes('Shift'),
                altKey: mods.includes('Alt'),
                metaKey: mods.includes('Meta') || mods.includes('Command'),
              };
              const target = document.activeElement || document.body;
              target.dispatchEvent(new KeyboardEvent('keydown', opts));
              target.dispatchEvent(new KeyboardEvent('keypress', opts));
              target.dispatchEvent(new KeyboardEvent('keyup', opts));
              return { success: true, key, target: (target.tagName || '').toLowerCase() };
            })()
          `)
        }
        case 'browser_extract_table': {
          if (!wv) throw new Error('No active webview')
          const tableSel = typeof args.selector === 'string' ? args.selector : 'table'
          return await wv.executeJavaScript(`
            (() => {
              const table = document.querySelector(${JSON.stringify(tableSel)});
              if (!table) return { error: 'Table not found: ${tableSel}' };
              const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent?.trim() || '');
              const rows = [];
              table.querySelectorAll('tbody tr, tr').forEach((tr, i) => {
                if (i === 0 && headers.length > 0 && tr.querySelector('th')) return;
                const cells = Array.from(tr.querySelectorAll('td, th')).map(td => td.textContent?.trim() || '');
                if (cells.length > 0) rows.push(cells);
              });
              return { headers, rows: rows.slice(0, 200), totalRows: rows.length };
            })()
          `)
        }
        case 'browser_fill_form': {
          if (!wv) throw new Error('No active webview')
          const fields = Array.isArray(args.fields) ? args.fields as Array<{ index: number; value: string }> : []
          if (fields.length === 0) return { error: 'fields array is required and must not be empty' }
          const results = []
          for (const field of fields) {
            const fi = Number(field.index)
            const fv = String(field.value ?? '')
            try {
              const r = await wv.executeJavaScript(`
                (() => {
                  const el = document.querySelector('[data-cf-idx="${fi}"]');
                  if (!el) return { error: 'Element not found for index ${fi}' };
                  el.scrollIntoView({ block: 'center' });
                  el.focus?.();
                  if ('value' in el) {
                    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                    const ns = Object.getOwnPropertyDescriptor(proto, 'value');
                    if (ns && ns.set) { ns.set.call(el, ${JSON.stringify(fv)}); }
                    else { el.value = ${JSON.stringify(fv)}; }
                  } else if (el.isContentEditable) {
                    el.textContent = ${JSON.stringify(fv)};
                  }
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return { success: true, index: ${fi} };
                })()
              `)
              results.push(r)
            } catch (e: any) {
              results.push({ error: e.message, index: fi })
            }
          }
          return { success: true, filled: results.length, results }
        }
        case 'browser_drag_and_drop': {
          if (!wv) throw new Error('No active webview')
          const srcIdx = Number(args.sourceIndex)
          const tgtIdx = Number(args.targetIndex)
          return await wv.executeJavaScript(`
            (async () => {
              const src = document.querySelector('[data-cf-idx="${srcIdx}"]');
              const tgt = document.querySelector('[data-cf-idx="${tgtIdx}"]');
              if (!src) return { error: 'Source element not found for index ${srcIdx}' };
              if (!tgt) return { error: 'Target element not found for index ${tgtIdx}' };
              src.scrollIntoView({ block: 'center' });
              const srcRect = src.getBoundingClientRect();
              const tgtRect = tgt.getBoundingClientRect();
              const sx = srcRect.left + srcRect.width / 2;
              const sy = srcRect.top + srcRect.height / 2;
              const tx = tgtRect.left + tgtRect.width / 2;
              const ty = tgtRect.top + tgtRect.height / 2;
              const dt = new DataTransfer();
              src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sx, clientY: sy }));
              await new Promise(r => setTimeout(r, 50));
              tgt.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
              tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
              await new Promise(r => setTimeout(r, 50));
              tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
              src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
              return { success: true, source: ${srcIdx}, target: ${tgtIdx} };
            })()
          `)
        }
        case 'browser_list_tabs': {
          return {
            tabs: tabs.map(t => ({
              tabId: t.id,
              url: t.url,
              title: t.title,
              isActive: t.id === activeTabId,
              isLoading: t.isLoading,
            })),
            activeTabId,
            count: tabs.length,
          }
        }
        case 'browser_open_tab': {
          const MAX_SESSION_TABS = 5
          if (tabs.length >= MAX_SESSION_TABS) {
            return { error: `Tab limit reached (max ${MAX_SESSION_TABS}). Close a tab first.` }
          }
          const tabUrl = typeof args.url === 'string' ? args.url : 'about:blank'
          const newTabId = addTab(tabUrl)
          return { success: true, tabId: newTabId, url: tabUrl, totalTabs: tabs.length + 1 }
        }
        case 'browser_close_tab': {
          const targetTabId = typeof args.tabId === 'string' ? args.tabId : ''
          if (!targetTabId) return { error: 'tabId is required' }
          const exists = tabs.some(t => t.id === targetTabId)
          if (!exists) return { error: `Tab not found: ${targetTabId}` }
          closeTab(targetTabId)
          return { success: true, closedTabId: targetTabId, remainingTabs: tabs.length - 1 }
        }
        case 'browser_switch_tab': {
          const switchTabId = typeof args.tabId === 'string' ? args.tabId : ''
          if (!switchTabId) return { error: 'tabId is required' }
          const found = tabs.find(t => t.id === switchTabId)
          if (!found) return { error: `Tab not found: ${switchTabId}` }
          setActiveTabId(switchTabId)
          return { success: true, activeTabId: switchTabId, url: found.url, title: found.title }
        }
        case 'browser_nuclear_type': {
          if (!wv) throw new Error('No active webview')
          const nti = Number(args.index)
          const ntText = typeof args.text === 'string' ? args.text : ''
          const ntClear = args.clearFirst !== false
          const ntEnter = args.pressEnter === true
          const ntDelay = typeof args.charDelay === 'number' ? args.charDelay : 20
          const ntStrat = typeof args.strategy === 'string' ? args.strategy : 'auto'
          return await wv.executeJavaScript(nuclearTypeScript(nti, ntText, ntClear, ntEnter, ntDelay, ntStrat))
        }
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
  }, [activeTabId, consoleEntries, tabs])

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
