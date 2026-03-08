export interface FormField {
  index: number
  tagName: string
  type: string
  name: string
  placeholder: string
  label: string
  required: boolean
}

export interface DetectedForm {
  formIndex: number
  action: string
  method: string
  fields: FormField[]
  submitButtons: Array<{
    index: number
    text: string
  }>
}

export interface FormScenario {
  id: string
  name: string
  formIndex: number
  fields: Array<{
    index: number
    value: string
  }>
  submitButtonIndex: number | null
  expectedOutcome: 'success' | 'error' | 'redirect'
}

export interface FormTestResult {
  scenarioId: string
  status: 'passed' | 'failed' | 'needs-review'
  startedAt: number
  endedAt: number
  consoleLogs: Array<{ level: string; message: string }>
  screenshotDataUrl: string | null
  networkRequests: Array<{ url: string; method: string; status: number }>
  notes: string
}
