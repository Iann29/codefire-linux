// ─── Core Models ──────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  path: string
  claudeProject: string | null
  lastOpened: string | null
  createdAt: string
  clientId: string | null
  tags: string | null
  sortOrder: number
}

export interface Session {
  id: string
  projectId: string
  slug: string | null
  startedAt: string | null
  endedAt: string | null
  model: string | null
  gitBranch: string | null
  summary: string | null
  messageCount: number
  toolUseCount: number
  filesChanged: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export interface LiveSessionState {
  sessionId: string
  slug: string | null
  model: string | null
  gitBranch: string | null
  startedAt: string | null
  lastActivity: string | null
  totalInputTokens: number
  totalOutputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  latestContextTokens: number
  messageCount: number
  userMessageCount: number
  toolUseCount: number
  filesChanged: string[]
  toolCounts: { name: string; count: number }[]
  recentActivity: { timestamp: string; type: 'userMessage' | 'assistantText' | 'toolUse'; detail: string }[]
  estimatedCost: number
  contextUsagePercent: number
  elapsedFormatted: string
  isActive: boolean
}

export interface TaskItem {
  id: number
  projectId: string
  title: string
  description: string | null
  status: string // 'todo' | 'in_progress' | 'done'
  priority: number // 0-4
  sourceSession: string | null
  source: string // 'manual' | 'claude' | 'ai-extracted'
  labels: string | null // JSON array
  attachments: string | null // JSON array
  isGlobal: number // 0 or 1 (SQLite boolean)
  gmailThreadId: string | null
  gmailMessageId: string | null
  recordingId: string | null
  createdAt: string
  completedAt: string | null
}

export interface TaskNote {
  id: number
  taskId: number
  content: string
  source: string // 'manual' | 'claude' | 'system'
  sessionId: string | null
  createdAt: string
}

export interface Note {
  id: number
  projectId: string
  title: string
  content: string
  pinned: number // 0 or 1
  sessionId: string | null
  isGlobal: number // 0 or 1
  createdAt: string
  updatedAt: string
}

export interface Client {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
}

// ─── Context Engine Models ────────────────────────────────────────────────────

export interface CodeChunk {
  id: string
  fileId: string
  projectId: string
  chunkType: string
  symbolName: string | null
  content: string
  startLine: number | null
  endLine: number | null
  embedding: Buffer | null
}

export interface IndexedFile {
  id: string
  projectId: string
  relativePath: string
  contentHash: string
  language: string | null
  lastIndexedAt: string
}

export interface IndexState {
  projectId: string
  status: string // 'idle' | 'indexing' | etc.
  lastFullIndexAt: string | null
  totalChunks: number
  lastError: string | null
}

export interface IndexRequest {
  id: number
  projectId: string
  projectPath: string
  status: string // 'pending' | 'processing' | 'done'
  createdAt: string
}

// ─── Browser Models ───────────────────────────────────────────────────────────

export interface BrowserCommand {
  id: number
  tool: string
  args: string | null
  status: string // 'pending' | 'running' | 'done' | 'error'
  result: string | null
  createdAt: string
  completedAt: string | null
}

export interface BrowserScreenshot {
  id: number
  projectId: string
  filePath: string
  pageURL: string | null
  pageTitle: string | null
  createdAt: string
}

// ─── Contextual Screenshot Models ─────────────────────────────────────────────

export interface ResolvePageContextInput {
  projectPath: string
  pageUrl: string
  pageTitle?: string | null
  runtimeRequests?: Array<{
    url: string
    method?: string
    type?: string
  }>
}

export interface PageContextEvidence {
  capturedAt: string
  pageUrl: string
  pageTitle: string | null
  route: {
    pathname: string
    matchedPath: string | null
    filePath: string | null
    routeType: 'static' | 'dynamic' | 'api' | 'catch-all' | 'unknown' | null
    framework: string | null
    confidence: 'confirmed' | 'inferred' | 'none'
  }
  components: Array<{
    name: string
    filePath: string
    relation: 'route-export' | 'direct-import' | 'direct-render' | 'one-hop-render'
    confidence: 'confirmed' | 'inferred'
  }>
  backend: Array<{
    label: string
    filePath: string | null
    kind: 'api-route' | 'server-action' | 'supabase-function' | 'network-endpoint'
    relation: 'observed-request' | 'direct-import' | 'route-companion' | 'convention-match'
    confidence: 'confirmed' | 'inferred'
  }>
}

// ─── Gmail Models ─────────────────────────────────────────────────────────────

export interface GmailAccount {
  id: string
  email: string
  lastHistoryId: string | null
  isActive: number // 0 or 1
  createdAt: string
  lastSyncAt: string | null
}

export interface ProcessedEmail {
  id: number
  gmailMessageId: string
  gmailThreadId: string
  gmailAccountId: string
  fromAddress: string
  fromName: string | null
  subject: string
  snippet: string | null
  body: string | null
  receivedAt: string
  taskId: number | null
  triageType: string | null
  isRead: number // 0 or 1
  repliedAt: string | null
  importedAt: string
}

export interface WhitelistRule {
  id: string
  pattern: string
  clientId: string | null
  priority: number
  isActive: number // 0 or 1
  createdAt: string
  note: string | null
}

// ─── Chat Attachment Models ───────────────────────────────────────────────────

export interface ChatAttachment {
  id: string
  kind: 'image' | 'file'
  name: string
  mimeType: string
  dataUrl: string  // base64 data URL for images
  source?: 'screenshot' | 'paste' | 'upload'
}

// ─── Chat Message Attachment Models ──────────────────────────────────────────

export interface ChatMessageAttachment {
  id: number
  messageId: number
  attachmentId: string
  kind: 'image' | 'file'
  name: string
  mimeType: string
  dataUrl: string
  source?: string
  createdAt: string
}

// ─── Chat Models ──────────────────────────────────────────────────────────────

export type ChatEffortLevel = 'default' | 'low' | 'medium' | 'high'

export type UsageSource = 'provider' | 'estimated' | 'session'

export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
  source?: UsageSource
}

export interface RunUsageSnapshot {
  callCount: number
  lastCall: TokenUsage | null
  total: TokenUsage | null
  provider?: string | null
  model?: string | null
  effortLevel?: ChatEffortLevel | null
  capturedAt?: string | null
  source?: UsageSource
}

export interface ChatConversation {
  id: number
  projectId: string | null
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: number
  conversationId: number
  role: string // 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  responseUsage?: TokenUsage | null
  runUsage?: RunUsageSnapshot | null
  provider?: string | null
  model?: string | null
  effortLevel?: ChatEffortLevel | null
  usageCapturedAt?: string | null
  attachments?: ChatMessageAttachment[]
}

// ─── Briefing Models ──────────────────────────────────────────────────────────

export interface BriefingDigest {
  id: number
  generatedAt: string
  itemCount: number
  status: string // 'generating' | 'ready'
}

export interface BriefingItem {
  id: number
  digestId: number
  title: string
  summary: string
  category: string
  sourceUrl: string
  sourceName: string
  publishedAt: string | null
  relevanceScore: number
  isSaved: number // 0 or 1
  isRead: number // 0 or 1
}

// ─── Media Models ─────────────────────────────────────────────────────────────

export interface GeneratedImage {
  id: number
  projectId: string
  prompt: string
  responseText: string | null
  filePath: string
  model: string
  aspectRatio: string | null
  imageSize: string | null
  parentImageId: number | null
  createdAt: string
}

export interface Recording {
  id: string
  projectId: string
  title: string
  audioPath: string
  duration: number
  transcript: string | null
  status: string // 'recording' | 'transcribing' | 'done' | 'error'
  errorMessage: string | null
  createdAt: string
}

// ─── Rate Limit Models ───────────────────────────────────────────────────────

export interface RateLimitInfo {
  provider: string
  providerName: string
  retryAfterMs: number | null
  remaining: number | null
  limit: number | null
  resetAt: number | null // epoch ms
  detectedAt: number // epoch ms
  fallbackProvider: string | null
}

// ─── AI Provider Type ────────────────────────────────────────────────────────

export type AIProviderType = 'openrouter' | 'custom' | 'claude-subscription' | 'openai-subscription' | 'gemini-subscription' | 'kimi-subscription'

// ─── Model Routing ──────────────────────────────────────────────────────────

export interface ModelRoutingRule {
  pattern: string       // prefix/glob-like: "claude-opus*", "gpt-*", "gemini-*"
  provider: AIProviderType  // which provider to route to
  label: string         // human description: "Opus via Claude Max"
}

// ─── App Config ──────────────────────────────────────────────────────────────

export interface AppConfig {
  // General
  checkForUpdates: boolean
  notifyOnNewEmail: boolean
  notifyOnClaudeDone: boolean
  demoMode: boolean
  preferredCLI: 'claude' | 'gemini' | 'codex'

  // Terminal
  terminalFontSize: number
  scrollbackLines: number
  defaultTerminalPath: string

  // Engine
  aiProvider: AIProviderType
  openRouterKey: string
  customEndpointUrl: string
  customEndpointKey: string
  contextSearchEnabled: boolean
  embeddingModel: string
  chatModel: string
  chatMode: 'context' | 'agent'
  chatEffortLevel: ChatEffortLevel
  agentRuntimeV2: boolean
  agentMaxToolCalls: number
  agentTemperature: number
  agentPlanEnforcement: boolean
  agentContextCompaction: boolean
  autoSnapshotSessions: boolean
  autoUpdateCodebaseTree: boolean
  instructionInjection: boolean
  snapshotDebounce: number

  // Gmail
  googleClientId: string
  googleClientSecret: string
  gmailSyncEnabled: boolean
  gmailSyncInterval: number

  // Model routing preferences
  modelRouting: ModelRoutingRule[]

  // Provider fallback
  fallbackProvider: 'openrouter' | 'none'

  // Browser
  browserAllowedDomains: string[]
  networkBodyLimit: number
  browserConfirmDestructive: boolean

  // Briefing
  briefingStalenessHours: number
  briefingRSSFeeds: string[]
  briefingSubreddits: string[]

  // Premium (Team Sync)
  premiumEnabled: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  autoShareSessions: boolean

  // Prompt overrides (empty string = use default)
  promptAgentSystem?: string
  promptContextSystem?: string
  promptSummarization?: string
  promptTaskExtraction?: string
  promptTaskDescription?: string
}

// ─── Visual Regression Models ────────────────────────────────────────────────

export interface VisualBaseline {
  id: number
  projectId: string
  routeKey: string
  pageUrl: string
  viewportWidth: number
  viewportHeight: number
  label: string | null
  imagePath: string
  createdAt: string
}

export interface VisualComparison {
  id: number
  projectId: string
  baselineId: number
  currentImagePath: string
  diffImagePath: string | null
  diffPercent: number
  status: string // 'pending' | 'passed' | 'failed' | 'approved'
  createdAt: string
}

// ─── Project Context (used by Prompt Compiler) ───────────────────────────────

export interface ProjectContextTask {
  title: string
  status: string
  priority: string
}

export interface ProjectContextMemory {
  name: string
  snippet: string
}

export interface ProjectContext {
  projectName: string
  projectPath: string
  techStack: string[]
  gitBranch: string | null
  openTasks: ProjectContextTask[]
  memories: ProjectContextMemory[]
}

// ─── Snapshot & Pattern Models ────────────────────────────────────────────────

export interface CodebaseSnapshot {
  id: number
  projectId: string
  capturedAt: string
  fileTree: string | null
  schemaHash: string | null
  keySymbols: string | null
  profileText: string | null
}

export interface Pattern {
  id: number
  projectId: string
  category: string
  title: string
  description: string
  sourceSession: string | null
  autoDetected: number // 0 or 1
  createdAt: string
}
