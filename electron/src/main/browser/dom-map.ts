/**
 * DOM Map script generator.
 * Extracted from BrowserView.tsx inline executeJavaScript.
 *
 * Builds a self-contained JS string that crawls the page DOM,
 * assigns data-cf-idx attributes to interactive elements,
 * and returns an indexed element map for browser automation.
 */

export interface DomMapOptions {
  maxElements?: number
}

/**
 * Build a self-contained JS string for DOM crawling.
 * Designed to be injected via webview.executeJavaScript().
 */
export function buildDomMapScript(opts?: DomMapOptions): string {
  const maxElements = Math.min(Math.max(opts?.maxElements ?? 500, 50), 1000)

  return `(() => {
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
  })()`
}
