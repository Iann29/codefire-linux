/**
 * Nuclear Click Script — robust clicking for complex web apps.
 * Ported from amage-ai-browser-agent/tools/nuclear-interaction-engine.ts
 *
 * 5 strategies for click with automatic fallback:
 * 1. Full pointer+mouse event chain with coordinates
 * 2. Native el.click()
 * 3. elementFromPoint (gets real element behind overlays/portals)
 * 4. Dispatch at coordinates on real target
 * 5. Closest interactive ancestor
 */

export interface NuclearClickOptions {
  index: number
}

/**
 * Build a self-contained JS string that can be evaluated via executeJavaScript.
 */
export function buildNuclearClickScript(opts: NuclearClickOptions): string {
  const index = opts.index

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

    // Strategy 1: Full pointer+mouse event chain
    function strategy1(target) {
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
      target.dispatchEvent(new PointerEvent('pointerover', opts));
      target.dispatchEvent(new MouseEvent('mouseover', opts));
      target.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
      target.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.focus?.();
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }

    // Strategy 2: Native click
    function strategy2(target) {
      target.click();
      return true;
    }

    // Strategy 3: elementFromPoint (real target behind overlays)
    function strategy3() {
      const realTarget = document.elementFromPoint(x, y);
      if (!realTarget || realTarget === el) return false;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
      realTarget.dispatchEvent(new PointerEvent('pointerdown', opts));
      realTarget.dispatchEvent(new MouseEvent('mousedown', opts));
      realTarget.focus?.();
      realTarget.dispatchEvent(new PointerEvent('pointerup', opts));
      realTarget.dispatchEvent(new MouseEvent('mouseup', opts));
      realTarget.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }

    // Strategy 4: Dispatch at coordinates on document
    function strategy4() {
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
      document.dispatchEvent(new MouseEvent('mousedown', opts));
      document.dispatchEvent(new MouseEvent('mouseup', opts));
      document.dispatchEvent(new MouseEvent('click', opts));
      return true;
    }

    // Strategy 5: Find closest interactive ancestor
    function strategy5(target) {
      const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'];
      let current = target;
      while (current && current !== document.body) {
        if (interactiveTags.includes(current.tagName) || current.getAttribute('role') === 'button' ||
            current.getAttribute('tabindex') !== null || current.onclick) {
          current.click();
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    // ─── Execute strategies ─────────────────────────────────────────────

    const strategies = [
      { name: 'pointerChain', fn: () => strategy1(el) },
      { name: 'nativeClick', fn: () => strategy2(el) },
      { name: 'elementFromPoint', fn: () => strategy3() },
      { name: 'documentCoords', fn: () => strategy4() },
      { name: 'interactiveAncestor', fn: () => strategy5(el) },
    ];

    let success = false;
    let usedStrategy = '';

    // For clicks, we run strategy1 first and trust it (can't easily verify)
    // If the element has specific feedback, we check after each
    for (const { name, fn } of strategies) {
      try {
        const result = fn();
        attempts.push({ method: name, success: result });
        if (result) {
          success = true;
          usedStrategy = name;
          break;
        }
      } catch (err) {
        attempts.push({ method: name, success: false, error: err.message });
      }
    }

    return {
      success,
      index: INDEX,
      strategy: usedStrategy,
      coordinates: { x: Math.round(x), y: Math.round(y) },
      attempts,
    };
  })()`
}
