/**
 * Nuclear Type Script — robust typing for rich text editors.
 * Ported from amage-ai-browser-agent/tools/nuclear-interaction-engine.ts
 *
 * Adapts from chrome.scripting.executeScript → Electron webContents.executeJavaScript.
 * Designed to be serialized and injected into the webview page context.
 */

export interface NuclearTypeOptions {
  text: string
  index: number
  clearFirst?: boolean
  pressEnter?: boolean
  charDelay?: number
  strategy?: 'auto' | 'keyboard' | 'execCommand' | 'inputEvent' | 'clipboard' | 'nativeSetter' | 'direct'
}

/**
 * Build a self-contained JS string that can be evaluated via executeJavaScript.
 * Returns the nuclear type script for the given options.
 */
export function buildNuclearTypeScript(opts: NuclearTypeOptions): string {
  const text = JSON.stringify(opts.text)
  const index = opts.index
  const clearFirst = opts.clearFirst !== false
  const pressEnter = opts.pressEnter === true
  const charDelay = opts.charDelay ?? 20
  const strategy = opts.strategy ?? 'auto'

  return `(async () => {
    const TEXT = ${text};
    const INDEX = ${index};
    const CLEAR_FIRST = ${clearFirst};
    const PRESS_ENTER = ${pressEnter};
    const CHAR_DELAY = ${charDelay};
    const STRATEGY = ${JSON.stringify(strategy)};

    const el = document.querySelector('[data-cf-idx="' + INDEX + '"]');
    if (!el) return { error: 'Element not found for index ' + INDEX + '. Call browser_dom_map again.' };

    el.scrollIntoView({ block: 'center', inline: 'center' });

    const attempts = [];

    // ─── Detect editor framework ────────────────────────────────────────

    function detectFramework(target) {
      // Draft.js
      if (target.closest('[data-contents]') || target.closest('.DraftEditor-root') || target.getAttribute('data-editor')) {
        return 'draftjs';
      }
      // Lexical
      if (target.closest('[data-lexical-editor]') || target.getAttribute('data-lexical-editor') === 'true') {
        return 'lexical';
      }
      // ProseMirror / Tiptap
      if (target.closest('.ProseMirror') || target.classList.contains('ProseMirror')) {
        return 'prosemirror';
      }
      // Slate
      if (target.closest('[data-slate-editor]') || target.getAttribute('data-slate-editor') === 'true') {
        return 'slate';
      }
      // Quill
      if (target.closest('.ql-editor') || target.classList.contains('ql-editor')) {
        return 'quill';
      }
      // CKEditor
      if (target.closest('.ck-editor__editable') || target.classList.contains('ck-editor__editable')) {
        return 'ckeditor';
      }
      // CodeMirror
      if (target.closest('.cm-editor') || target.closest('.CodeMirror')) {
        return 'codemirror';
      }
      // Monaco
      if (target.closest('.monaco-editor')) {
        return 'monaco';
      }
      return null;
    }

    // ─── Find editable child ────────────────────────────────────────────

    function findEditableChild(target) {
      if (target.isContentEditable) return target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return target;

      // Deep discovery: search children for contenteditable
      const editable = target.querySelector('[contenteditable="true"]');
      if (editable) return editable;

      // Look for input/textarea inside
      const input = target.querySelector('input, textarea');
      if (input) return input;

      return target;
    }

    // ─── Activate editor ────────────────────────────────────────────────

    function activateEditor(target) {
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      target.focus();
      target.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      // Place caret at end
      if (target.isContentEditable) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else if ('setSelectionRange' in target) {
        const len = target.value ? target.value.length : 0;
        target.setSelectionRange(len, len);
      }
    }

    // ─── Clear content ──────────────────────────────────────────────────

    function clearContent(target) {
      if ('value' in target && target.tagName !== 'DIV') {
        // Native input/textarea
        const nativeSetter = Object.getOwnPropertyDescriptor(
          target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        );
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(target, '');
          target.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          target.value = '';
        }
      } else if (target.isContentEditable) {
        // Select all + delete
        const sel = window.getSelection();
        sel.selectAllChildren(target);
        document.execCommand('delete', false);

        // Fallback
        if (target.textContent && target.textContent.length > 0) {
          target.textContent = '';
        }
      }
    }

    // ─── Typing strategies ──────────────────────────────────────────────

    async function strategyKeyboard(target, text) {
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        target.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
        target.dispatchEvent(new InputEvent('beforeinput', { data: char, inputType: 'insertText', bubbles: true, cancelable: true }));
        target.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));
        if (CHAR_DELAY > 0 && i < text.length - 1) {
          await new Promise(r => setTimeout(r, CHAR_DELAY + Math.random() * 10));
        }
      }
      return true;
    }

    function strategyExecCommand(target, text) {
      // Works for Draft.js, Quill, CKEditor
      return document.execCommand('insertText', false, text);
    }

    function strategyInputEvent(target, text) {
      // Works for Lexical, ProseMirror
      target.dispatchEvent(new InputEvent('beforeinput', {
        data: text,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      }));
      target.dispatchEvent(new InputEvent('input', {
        data: text,
        inputType: 'insertText',
        bubbles: true,
      }));
      return true;
    }

    async function strategyClipboard(target, text) {
      // Simulate paste — universal fallback
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboardData,
      });
      target.dispatchEvent(pasteEvent);
      return true;
    }

    function strategyNativeSetter(target, text) {
      // React nativeInputValueSetter — for <input>/<textarea>
      const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (nativeSetter && nativeSetter.set) {
        const currentValue = target.value || '';
        nativeSetter.set.call(target, currentValue + text);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    function strategyDirect(target, text) {
      // Last resort: direct DOM manipulation
      if ('value' in target && target.tagName !== 'DIV') {
        target.value = (target.value || '') + text;
      } else if (target.isContentEditable) {
        const textNode = document.createTextNode(text);
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          target.appendChild(textNode);
        }
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // ─── Verify text inserted ───────────────────────────────────────────

    function verifyText(target, expectedText) {
      let actual = '';
      if ('value' in target && target.tagName !== 'DIV') {
        actual = target.value || '';
      } else if (target.isContentEditable) {
        actual = target.textContent || '';
      }

      // Strip zero-width chars
      actual = actual.replace(/[\\u200B\\uFEFF\\u00AD]/g, '');
      const expected = expectedText.replace(/[\\u200B\\uFEFF\\u00AD]/g, '');

      // Exact match
      if (actual.includes(expected)) return { verified: true, method: 'exact' };
      // Normalized match
      const normActual = actual.toLowerCase().replace(/\\s+/g, ' ').trim();
      const normExpected = expected.toLowerCase().replace(/\\s+/g, ' ').trim();
      if (normActual.includes(normExpected)) return { verified: true, method: 'normalized' };
      // Partial match (60%)
      const minLen = Math.min(normActual.length, normExpected.length);
      let matchLen = 0;
      for (let i = 0; i < minLen; i++) {
        if (normActual[normActual.length - minLen + i] === normExpected[i]) matchLen++;
      }
      if (minLen > 0 && matchLen / normExpected.length >= 0.6) {
        return { verified: true, method: 'partial' };
      }
      return { verified: false, actual: actual.slice(-100), expected: expected.slice(0, 100) };
    }

    // ─── Main execution ─────────────────────────────────────────────────

    const target = findEditableChild(el);
    const framework = detectFramework(target);

    activateEditor(target);

    if (CLEAR_FIRST) {
      clearContent(target);
      await new Promise(r => setTimeout(r, 50));
    }

    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    // Determine strategy order
    let strategies;
    if (STRATEGY !== 'auto') {
      strategies = [STRATEGY];
    } else if (isInput) {
      strategies = ['nativeSetter', 'keyboard', 'direct'];
    } else if (framework === 'draftjs' || framework === 'quill' || framework === 'ckeditor') {
      strategies = ['execCommand', 'keyboard', 'clipboard', 'direct'];
    } else if (framework === 'lexical' || framework === 'prosemirror') {
      strategies = ['inputEvent', 'execCommand', 'keyboard', 'clipboard', 'direct'];
    } else if (framework === 'slate') {
      strategies = ['inputEvent', 'clipboard', 'keyboard', 'direct'];
    } else if (framework === 'codemirror' || framework === 'monaco') {
      strategies = ['keyboard', 'clipboard', 'direct'];
    } else {
      strategies = ['execCommand', 'inputEvent', 'nativeSetter', 'keyboard', 'clipboard', 'direct'];
    }

    let success = false;
    let usedStrategy = '';

    for (const strat of strategies) {
      try {
        let result = false;
        switch (strat) {
          case 'keyboard': result = await strategyKeyboard(target, TEXT); break;
          case 'execCommand': result = strategyExecCommand(target, TEXT); break;
          case 'inputEvent': result = strategyInputEvent(target, TEXT); break;
          case 'clipboard': result = await strategyClipboard(target, TEXT); break;
          case 'nativeSetter': result = strategyNativeSetter(target, TEXT); break;
          case 'direct': result = strategyDirect(target, TEXT); break;
        }

        attempts.push({ strategy: strat, result });

        if (result) {
          await new Promise(r => setTimeout(r, 50));
          const verification = verifyText(target, TEXT);
          attempts[attempts.length - 1].verification = verification;
          if (verification.verified) {
            success = true;
            usedStrategy = strat;
            break;
          }
        }
      } catch (err) {
        attempts.push({ strategy: strat, error: err.message });
      }
    }

    if (PRESS_ENTER) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    return {
      success,
      index: INDEX,
      strategy: usedStrategy || 'none',
      framework: framework || 'unknown',
      attempts,
      textLength: TEXT.length,
    };
  })()`
}
