import { useState, useCallback } from 'react'
import {
  FlaskConical,
  Search,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  X,
} from 'lucide-react'
import type { DetectedForm, FormScenario, FormTestResult, FormField } from './types'

const FAKE_DATA: Record<string, string> = {
  email: 'test@example.com',
  name: 'John Test',
  tel: '+1234567890',
  text: 'This is a test message',
  url: 'https://example.com',
  number: '42',
  password: 'TestPass123!',
  search: 'test query',
  date: '2026-03-08',
  time: '14:30',
  color: '#ff6600',
  range: '50',
  month: '2026-03',
  week: '2026-W10',
}

function getFakeValue(field: FormField): string {
  // Try by input type first
  if (FAKE_DATA[field.type]) return FAKE_DATA[field.type]
  // Try by name (common patterns)
  const nameLower = field.name.toLowerCase()
  if (nameLower.includes('email')) return FAKE_DATA.email
  if (nameLower.includes('phone') || nameLower.includes('tel')) return FAKE_DATA.tel
  if (nameLower.includes('name')) return FAKE_DATA.name
  if (nameLower.includes('pass')) return FAKE_DATA.password
  if (nameLower.includes('url') || nameLower.includes('website')) return FAKE_DATA.url
  if (nameLower.includes('search')) return FAKE_DATA.search
  // Fallback
  return FAKE_DATA.text
}

interface FormTesterPanelProps {
  getActiveWebview: () => any
  onClose: () => void
}

export default function FormTesterPanel({ getActiveWebview, onClose }: FormTesterPanelProps) {
  const [detectedForms, setDetectedForms] = useState<DetectedForm[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [scenarios, setScenarios] = useState<FormScenario[]>([])
  const [results, setResults] = useState<FormTestResult[]>([])
  const [expandedForm, setExpandedForm] = useState<number | null>(null)
  const [editingScenario, setEditingScenario] = useState<FormScenario | null>(null)
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null)
  const [selectedResult, setSelectedResult] = useState<FormTestResult | null>(null)

  const discoverForms = useCallback(async () => {
    const wv = getActiveWebview()
    if (!wv) return

    setDiscovering(true)
    try {
      const result = await wv.executeJavaScript(`
        (() => {
          const forms = document.querySelectorAll('form')
          if (forms.length === 0) {
            // Also look for forms by common patterns
            const possibleForms = document.querySelectorAll('[role="form"], [data-form], .form')
            if (possibleForms.length === 0) return { forms: [], message: 'No forms found on this page' }
          }

          const detected = []
          const allForms = document.querySelectorAll('form')

          allForms.forEach((form, formIdx) => {
            const fields = []
            const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')

            inputs.forEach((input, inputIdx) => {
              const globalIdx = formIdx * 1000 + inputIdx
              input.setAttribute('data-cf-form-field', String(globalIdx))

              // Try to find label
              let label = ''
              const id = input.getAttribute('id')
              if (id) {
                const labelEl = document.querySelector('label[for="' + id + '"]')
                if (labelEl) label = (labelEl.textContent || '').trim()
              }
              if (!label) {
                const parentLabel = input.closest('label')
                if (parentLabel) label = (parentLabel.textContent || '').replace((input.value || ''), '').trim()
              }
              if (!label) {
                const ariaLabel = input.getAttribute('aria-label')
                if (ariaLabel) label = ariaLabel
              }

              fields.push({
                index: globalIdx,
                tagName: input.tagName.toLowerCase(),
                type: input.getAttribute('type') || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName === 'SELECT' ? 'select' : 'text'),
                name: input.getAttribute('name') || '',
                placeholder: input.getAttribute('placeholder') || '',
                label: label.slice(0, 100),
                required: input.hasAttribute('required'),
              })
            })

            // Find submit buttons
            const submitButtons = []
            const buttons = form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')
            buttons.forEach((btn, btnIdx) => {
              const globalBtnIdx = formIdx * 1000 + 900 + btnIdx
              btn.setAttribute('data-cf-form-btn', String(globalBtnIdx))
              submitButtons.push({
                index: globalBtnIdx,
                text: (btn.textContent || btn.getAttribute('value') || 'Submit').trim().slice(0, 50),
              })
            })

            detected.push({
              formIndex: formIdx,
              action: form.getAttribute('action') || '',
              method: (form.getAttribute('method') || 'GET').toUpperCase(),
              fields,
              submitButtons,
            })
          })

          return { forms: detected }
        })()
      `)

      if (result?.forms) {
        setDetectedForms(result.forms)
        if (result.forms.length > 0) {
          setExpandedForm(0)
        }
      }
    } catch (err) {
      console.error('Form discovery failed:', err)
    } finally {
      setDiscovering(false)
    }
  }, [getActiveWebview])

  const createScenario = useCallback((form: DetectedForm) => {
    const scenario: FormScenario = {
      id: crypto.randomUUID(),
      name: `Test ${form.method} ${form.action || 'form'}`,
      formIndex: form.formIndex,
      fields: form.fields.map((f) => ({
        index: f.index,
        value: getFakeValue(f),
      })),
      submitButtonIndex: form.submitButtons.length > 0 ? form.submitButtons[0].index : null,
      expectedOutcome: 'success',
    }
    setEditingScenario(scenario)
  }, [])

  const saveScenario = useCallback(() => {
    if (!editingScenario) return
    setScenarios((prev) => {
      const exists = prev.findIndex((s) => s.id === editingScenario.id)
      if (exists >= 0) {
        const updated = [...prev]
        updated[exists] = editingScenario
        return updated
      }
      return [...prev, editingScenario]
    })
    setEditingScenario(null)
  }, [editingScenario])

  const runScenario = useCallback(async (scenario: FormScenario) => {
    const wv = getActiveWebview()
    if (!wv) return

    setRunningScenarioId(scenario.id)
    const startedAt = Date.now()
    const consoleLogs: Array<{ level: string; message: string }> = []

    try {
      // Fill fields
      for (const field of scenario.fields) {
        await wv.executeJavaScript(`
          (() => {
            const el = document.querySelector('[data-cf-form-field="${field.index}"]')
            if (!el) return { error: 'Field not found: ${field.index}' }
            el.scrollIntoView({ block: 'center' })
            el.focus()

            if (el.tagName === 'SELECT') {
              el.value = ${JSON.stringify(field.value)}
              el.dispatchEvent(new Event('change', { bubbles: true }))
              return { success: true }
            }

            // Use native setter for React compatibility
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')
            if (nativeSetter && nativeSetter.set) {
              nativeSetter.set.call(el, ${JSON.stringify(field.value)})
            } else {
              el.value = ${JSON.stringify(field.value)}
            }
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            return { success: true }
          })()
        `)
        // Small delay between fields for realistic behavior
        await new Promise((r) => setTimeout(r, 100))
      }

      // Wait a moment before clicking submit
      await new Promise((r) => setTimeout(r, 300))

      // Click submit button
      if (scenario.submitButtonIndex !== null) {
        await wv.executeJavaScript(`
          (() => {
            const btn = document.querySelector('[data-cf-form-btn="${scenario.submitButtonIndex}"]')
            if (!btn) {
              // Fallback: try to submit the form directly
              const form = document.querySelectorAll('form')[${scenario.formIndex}]
              if (form) {
                form.requestSubmit ? form.requestSubmit() : form.submit()
                return { success: true, method: 'form.submit' }
              }
              return { error: 'Submit button not found' }
            }
            btn.click()
            return { success: true, method: 'button.click' }
          })()
        `)
      }

      // Wait for response
      await new Promise((r) => setTimeout(r, 2000))

      // Capture console logs from the webview
      const logs = await wv.executeJavaScript(`
        (() => {
          // Collect any error indicators on the page
          const errors = []
          const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"], .invalid-feedback, .form-error')
          errorElements.forEach((el) => {
            const text = (el.textContent || '').trim()
            if (text) errors.push({ level: 'error', message: text.slice(0, 200) })
          })

          // Check for success indicators
          const successElements = document.querySelectorAll('[class*="success"], [class*="Success"], .alert-success')
          successElements.forEach((el) => {
            const text = (el.textContent || '').trim()
            if (text) errors.push({ level: 'info', message: text.slice(0, 200) })
          })

          return errors
        })()
      `)

      if (Array.isArray(logs)) {
        consoleLogs.push(...logs)
      }

      // Take screenshot
      let screenshotDataUrl: string | null = null
      try {
        const img = await wv.capturePage()
        screenshotDataUrl = img.toDataURL()
      } catch {
        // Screenshot capture may fail
      }

      const endedAt = Date.now()

      // Determine status
      const hasErrors = consoleLogs.some((l) => l.level === 'error')
      const hasSuccess = consoleLogs.some((l) => l.level === 'info')
      let status: 'passed' | 'failed' | 'needs-review' = 'needs-review'

      if (scenario.expectedOutcome === 'success') {
        if (hasSuccess && !hasErrors) status = 'passed'
        else if (hasErrors) status = 'failed'
      } else if (scenario.expectedOutcome === 'error') {
        if (hasErrors) status = 'passed'
        else if (hasSuccess) status = 'failed'
      }

      const result: FormTestResult = {
        scenarioId: scenario.id,
        status,
        startedAt,
        endedAt,
        consoleLogs,
        screenshotDataUrl,
        networkRequests: [],
        notes: `Duration: ${endedAt - startedAt}ms. ${consoleLogs.length} log entries captured.`,
      }

      setResults((prev) => [result, ...prev])
    } catch (err: any) {
      const result: FormTestResult = {
        scenarioId: scenario.id,
        status: 'failed',
        startedAt,
        endedAt: Date.now(),
        consoleLogs: [{ level: 'error', message: err.message || String(err) }],
        screenshotDataUrl: null,
        networkRequests: [],
        notes: `Execution error: ${err.message}`,
      }
      setResults((prev) => [result, ...prev])
    } finally {
      setRunningScenarioId(null)
    }
  }, [getActiveWebview])

  const deleteScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id))
    setResults((prev) => prev.filter((r) => r.scenarioId !== id))
  }, [])

  const statusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 size={14} className="text-green-400" />
      case 'failed':
        return <XCircle size={14} className="text-red-400" />
      default:
        return <AlertTriangle size={14} className="text-yellow-400" />
    }
  }

  return (
    <div className="flex flex-col border-t border-neutral-800 bg-neutral-950 max-h-[50vh] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-codefire-orange" />
          <span className="text-xs font-medium text-neutral-300">Form Tester</span>
          <span className="text-[10px] text-neutral-600">
            {detectedForms.length > 0 ? `${detectedForms.length} form(s)` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={discoverForms}
            disabled={discovering}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            <Search size={10} />
            {discovering ? 'Scanning...' : 'Discover Forms'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {/* Detected Forms */}
        {detectedForms.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider px-1">Detected Forms</div>
            {detectedForms.map((form) => (
              <div key={form.formIndex} className="bg-neutral-900 rounded border border-neutral-800">
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-neutral-800/50 transition-colors"
                  onClick={() => setExpandedForm(expandedForm === form.formIndex ? null : form.formIndex)}
                >
                  {expandedForm === form.formIndex ? (
                    <ChevronDown size={12} className="text-neutral-500" />
                  ) : (
                    <ChevronRight size={12} className="text-neutral-500" />
                  )}
                  <span className="text-xs text-neutral-300">
                    <span className="text-codefire-orange">{form.method}</span>{' '}
                    {form.action || '(no action)'}
                  </span>
                  <span className="text-[10px] text-neutral-600 ml-auto">
                    {form.fields.length} field(s)
                  </span>
                </button>

                {expandedForm === form.formIndex && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {form.fields.map((field) => (
                      <div key={field.index} className="flex items-center gap-2 text-[10px] text-neutral-400 pl-4">
                        <span className="text-neutral-600 w-16 shrink-0 truncate">
                          {field.type}
                        </span>
                        <span className="text-neutral-300 truncate flex-1">
                          {field.label || field.name || field.placeholder || '(unnamed)'}
                        </span>
                        {field.required && (
                          <span className="text-red-500 text-[8px]">REQ</span>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => createScenario(form)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 transition-colors"
                      >
                        <Plus size={10} />
                        Create Test Scenario
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Scenario Editor */}
        {editingScenario && (
          <div className="bg-neutral-900 rounded border border-codefire-orange/30 p-2 space-y-2">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Edit Scenario</div>
            <input
              type="text"
              value={editingScenario.name}
              onChange={(e) =>
                setEditingScenario({ ...editingScenario, name: e.target.value })
              }
              className="w-full px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded text-neutral-200 outline-none focus:border-codefire-orange/50"
              placeholder="Scenario name"
            />

            <div className="space-y-1">
              <div className="text-[10px] text-neutral-500">Field Values</div>
              {editingScenario.fields.map((field, idx) => {
                const form = detectedForms.find((f) => f.formIndex === editingScenario.formIndex)
                const formField = form?.fields.find((f) => f.index === field.index)
                return (
                  <div key={field.index} className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-500 w-24 truncate shrink-0">
                      {formField?.label || formField?.name || formField?.placeholder || `Field ${idx + 1}`}
                    </span>
                    <input
                      type="text"
                      value={field.value}
                      onChange={(e) => {
                        const newFields = [...editingScenario.fields]
                        newFields[idx] = { ...field, value: e.target.value }
                        setEditingScenario({ ...editingScenario, fields: newFields })
                      }}
                      className="flex-1 px-2 py-0.5 text-[10px] bg-neutral-800 border border-neutral-700 rounded text-neutral-200 outline-none focus:border-codefire-orange/50"
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-500">Expected:</span>
              {(['success', 'error', 'redirect'] as const).map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  onClick={() =>
                    setEditingScenario({ ...editingScenario, expectedOutcome: outcome })
                  }
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    editingScenario.expectedOutcome === outcome
                      ? 'bg-codefire-orange/20 text-codefire-orange'
                      : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {outcome}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={saveScenario}
                className="px-3 py-1 text-[10px] rounded bg-codefire-orange text-white hover:bg-codefire-orange/80 transition-colors"
              >
                Save Scenario
              </button>
              <button
                type="button"
                onClick={() => setEditingScenario(null)}
                className="px-3 py-1 text-[10px] rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Scenarios List */}
        {scenarios.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider px-1">Test Scenarios</div>
            {scenarios.map((scenario) => {
              const latestResult = results.find((r) => r.scenarioId === scenario.id)
              const isRunning = runningScenarioId === scenario.id
              return (
                <div
                  key={scenario.id}
                  className="flex items-center gap-2 px-2 py-1.5 bg-neutral-900 rounded border border-neutral-800"
                >
                  {latestResult && statusIcon(latestResult.status)}
                  <span className="text-xs text-neutral-300 flex-1 truncate">{scenario.name}</span>
                  <span className="text-[10px] text-neutral-600">
                    {scenario.fields.length} fields
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingScenario({ ...scenario })}
                    className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => runScenario(scenario)}
                    disabled={isRunning}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors disabled:opacity-50"
                  >
                    <Play size={10} />
                    {isRunning ? 'Running...' : 'Run'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteScenario(scenario.id)}
                    className="text-neutral-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Test Results */}
        {results.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider px-1">
              Results ({results.length})
            </div>
            {results.map((result, idx) => {
              const scenario = scenarios.find((s) => s.id === result.scenarioId)
              return (
                <div key={idx} className="bg-neutral-900 rounded border border-neutral-800">
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-neutral-800/50 transition-colors"
                    onClick={() => setSelectedResult(selectedResult === result ? null : result)}
                  >
                    {statusIcon(result.status)}
                    <span className="text-xs text-neutral-300 flex-1 truncate">
                      {scenario?.name || result.scenarioId}
                    </span>
                    <span className="text-[10px] text-neutral-600">
                      {result.endedAt - result.startedAt}ms
                    </span>
                    {result.screenshotDataUrl && (
                      <ImageIcon size={12} className="text-neutral-600" />
                    )}
                  </button>

                  {selectedResult === result && (
                    <div className="px-2 pb-2 space-y-1.5 border-t border-neutral-800">
                      <div className="text-[10px] text-neutral-500 pt-1">{result.notes}</div>

                      {result.consoleLogs.length > 0 && (
                        <div className="space-y-0.5">
                          <div className="text-[10px] text-neutral-500">Captured Messages</div>
                          {result.consoleLogs.map((log, logIdx) => (
                            <div
                              key={logIdx}
                              className={`text-[10px] pl-2 ${
                                log.level === 'error'
                                  ? 'text-red-400'
                                  : log.level === 'warning'
                                    ? 'text-yellow-400'
                                    : 'text-green-400'
                              }`}
                            >
                              [{log.level}] {log.message}
                            </div>
                          ))}
                        </div>
                      )}

                      {result.screenshotDataUrl && (
                        <div className="pt-1">
                          <div className="text-[10px] text-neutral-500 mb-1">Screenshot</div>
                          <img
                            src={result.screenshotDataUrl}
                            alt="Test result screenshot"
                            className="max-w-full max-h-48 rounded border border-neutral-700"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {detectedForms.length === 0 && scenarios.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-neutral-600">
            <FlaskConical size={24} className="mb-2 opacity-50" />
            <p className="text-xs">Click "Discover Forms" to scan the current page</p>
          </div>
        )}
      </div>
    </div>
  )
}
