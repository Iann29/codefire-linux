/**
 * Browser and plan tool schemas.
 *
 * These tools have special routing in AgentService (browser tools go
 * through BrowserBridge, plan tools mutate run state) so we only
 * export raw ProviderToolSchema arrays -- no ToolDefinition execute
 * functions.
 */

import type { ProviderToolSchema } from '../ToolContracts'

// ---------------------------------------------------------------------------
// Browser tool name sets
// ---------------------------------------------------------------------------

export const BROWSER_TOOL_NAMES = new Set<string>([
  'browser_navigate',
  'browser_snapshot',
  'browser_screenshot',
  'browser_click',
  'browser_type',
  'browser_eval',
  'browser_console_logs',
  'browser_dom_map',
  'browser_click_element',
  'browser_type_element',
  'browser_select_element',
  'browser_hover_element',
  'browser_scroll_to_element',
  'browser_get_element_info',
  'browser_wait_element',
  'browser_wait_navigation',
  'browser_get_content',
  'browser_press_key',
  'browser_extract_table',
  'browser_nuclear_type',
  'browser_nuclear_click',
  'browser_list_tabs',
  'browser_open_tab',
  'browser_close_tab',
  'browser_switch_tab',
  'browser_fill_form',
  'browser_drag_and_drop',
  'browser_reset_session',
])

export const VERIFICATION_BROWSER_TOOLS = new Set<string>([
  'browser_dom_map',
  'browser_get_element_info',
  'browser_snapshot',
  'browser_console_logs',
])

export const URL_BEARING_TOOLS = new Set<string>([
  'browser_navigate',
  'browser_open_tab',
])

export const DESTRUCTIVE_BROWSER_TOOLS = new Set<string>([
  'browser_nuclear_click',
  'browser_nuclear_type',
  'browser_fill_form',
  'browser_drag_and_drop',
])

// ---------------------------------------------------------------------------
// Plan tool schemas
// ---------------------------------------------------------------------------

export function createPlanToolSchemas(): ProviderToolSchema[] {
  return [
    {
      type: 'function',
      function: {
        name: 'set_plan',
        description: 'Define a browser-specific plan immediately before the first browser action. Use 3-8 actionable steps.',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              description: 'List of plan step titles.',
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                    },
                    required: ['title'],
                  },
                ],
              },
            },
          },
          required: ['steps'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_plan',
        description: 'Update the active browser plan after verifying the previous browser action.',
        parameters: {
          type: 'object',
          properties: {
            step_index: { type: 'number', description: 'Index of the step to update.' },
            status: { type: 'string', enum: ['pending', 'done', 'blocked'], description: 'New status for the step.' },
          },
          required: ['step_index', 'status'],
        },
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Browser tool schemas
// ---------------------------------------------------------------------------

export function createBrowserToolSchemas(): ProviderToolSchema[] {
  return [
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: 'Navigate the browser to a URL.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to navigate to.' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_dom_map',
        description: 'Map interactive DOM elements and assign stable indices for browser automation.',
        parameters: {
          type: 'object',
          properties: {
            max_elements: { type: 'number', description: 'Maximum number of elements to map.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click_element',
        description: 'Click an element by DOM map index.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index.' },
          },
          required: ['index'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_type_element',
        description: 'Type text into an element by DOM map index.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index.' },
            text: { type: 'string', description: 'Text to type.' },
            clearFirst: { type: 'boolean', description: 'Clear existing content before typing.' },
            pressEnter: { type: 'boolean', description: 'Press Enter after typing.' },
          },
          required: ['index', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_select_element',
        description: 'Select an option in a <select> element by DOM map index.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index.' },
            value: { type: 'string', description: 'Value to select.' },
          },
          required: ['index', 'value'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_hover_element',
        description: 'Move pointer over an element by DOM map index.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index.' },
          },
          required: ['index'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll_to_element',
        description: 'Scroll an element into view by DOM map index.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index.' },
            block: { type: 'string', description: 'Scroll alignment.' },
          },
          required: ['index'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_element_info',
        description: 'Get details for an indexed DOM element.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index.' },
          },
          required: ['index'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait_element',
        description: 'Wait for an element to reach a state: attached, detached, visible, or hidden.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector' },
            state: { type: 'string', enum: ['attached', 'detached', 'visible', 'hidden'], description: 'Target state.' },
            timeout: { type: 'number', description: 'Timeout in ms (default 5000)' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait_navigation',
        description: 'Wait for page navigation to complete.',
        parameters: {
          type: 'object',
          properties: {
            strategy: { type: 'string', enum: ['load', 'networkidle', 'urlchange'], description: 'Wait strategy.' },
            timeout: { type: 'number', description: 'Timeout in ms (default 10000)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_content',
        description: 'Get page content in different modes: text, html, url, title, links, or meta.',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['text', 'html', 'url', 'title', 'links', 'meta'], description: 'Content mode.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_press_key',
        description: 'Press a keyboard key with optional modifiers.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, a, etc.' },
            modifiers: { type: 'array', items: { type: 'string' }, description: 'Array of modifiers: Control, Shift, Alt, Meta' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_extract_table',
        description: 'Extract a table from the page as JSON with headers and rows.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector for the table (default: "table")' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_nuclear_type',
        description: 'Type text into an element using nuclear interaction engine (robust for rich text editors like Draft.js, Lexical, ProseMirror, Slate, Quill, CKEditor, CodeMirror, Monaco). Tries multiple strategies with auto-detection and verification. Use when browser_type_element fails on complex editors.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index' },
            text: { type: 'string', description: 'Text to type' },
            clearFirst: { type: 'boolean', description: 'Clear existing content before typing (default true)' },
            pressEnter: { type: 'boolean', description: 'Press Enter after typing (default false)' },
            charDelay: { type: 'number', description: 'Delay between chars in ms for keyboard strategy (default 20)' },
            strategy: { type: 'string', enum: ['auto', 'keyboard', 'execCommand', 'inputEvent', 'clipboard', 'nativeSetter', 'direct'], description: 'Typing strategy (default auto)' },
          },
          required: ['index', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_nuclear_click',
        description: 'Click an element using nuclear interaction engine (robust for overlays, React portals, synthetic event listeners). Tries 4 strategies: pointer chain, native click, elementFromPoint, interactive ancestor. Use when browser_click_element fails on complex UIs.',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'DOM map element index' },
          },
          required: ['index'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_fill_form',
        description: 'Fill multiple form fields at once. Each field is identified by DOM map index.',
        parameters: {
          type: 'object',
          properties: {
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'number', description: 'DOM map element index' },
                  value: { type: 'string', description: 'Value to set' },
                },
                required: ['index', 'value'],
              },
              description: 'Array of { index, value } pairs',
            },
          },
          required: ['fields'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_drag_and_drop',
        description: 'Drag an element to another element by DOM map indices.',
        parameters: {
          type: 'object',
          properties: {
            sourceIndex: { type: 'number', description: 'DOM map index of source element' },
            targetIndex: { type: 'number', description: 'DOM map index of target element' },
          },
          required: ['sourceIndex', 'targetIndex'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_list_tabs',
        description: 'List all open browser tabs with their URL, title, and active status.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_open_tab',
        description: 'Open a new browser tab with a URL. Limited to 5 tabs per session.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to open in the new tab' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close_tab',
        description: 'Close a browser tab by its tab ID.',
        parameters: {
          type: 'object',
          properties: {
            tabId: { type: 'string', description: 'Tab ID to close (from browser_list_tabs)' },
          },
          required: ['tabId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_switch_tab',
        description: 'Switch to a browser tab by its tab ID.',
        parameters: {
          type: 'object',
          properties: {
            tabId: { type: 'string', description: 'Tab ID to activate (from browser_list_tabs)' },
          },
          required: ['tabId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_reset_session',
        description: 'Clear all browser cookies, cache, localStorage, and session data. Use before testing login, onboarding, or stateful flows.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
  ]
}
