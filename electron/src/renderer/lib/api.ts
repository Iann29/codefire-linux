import type {
  Project,
  TaskItem,
  TaskNote,
  Note,
  Session,
  Client,
  GeneratedImage,
  Recording,
  GmailAccount,
  WhitelistRule,
  ProcessedEmail,
  AppConfig,
  LiveSessionState,
  BriefingDigest,
  BriefingItem,
  ChatConversation,
  ChatMessage,
  ChatAttachment,
  RunUsageSnapshot,
  TokenUsage,
  ChatEffortLevel,
  VisualBaseline,
  VisualComparison,
} from '@shared/models'
const invoke = window.api.invoke

export const api = {
  projects: {
    list: () => invoke('projects:list') as Promise<Project[]>,
    get: (id: string) => invoke('projects:get', id) as Promise<Project | undefined>,
    getByPath: (path: string) =>
      invoke('projects:getByPath', path) as Promise<Project | undefined>,
    create: (data: {
      id?: string
      name: string
      path: string
      claudeProject?: string
      clientId?: string
      tags?: string
    }) => invoke('projects:create', data) as Promise<Project>,
    update: (
      id: string,
      data: {
        name?: string
        path?: string
        claudeProject?: string | null
        clientId?: string | null
        tags?: string | null
        sortOrder?: number
      }
    ) => invoke('projects:update', id, data) as Promise<Project | undefined>,
    updateLastOpened: (id: string) =>
      invoke('projects:updateLastOpened', id) as Promise<void>,
    delete: (id: string) => invoke('projects:delete', id) as Promise<boolean>,
  },

  tasks: {
    list: (projectId: string, status?: string) =>
      invoke('tasks:list', projectId, status) as Promise<TaskItem[]>,
    listGlobal: (status?: string) =>
      invoke('tasks:listGlobal', status) as Promise<TaskItem[]>,
    listAll: (status?: string) =>
      invoke('tasks:listAll', status) as Promise<TaskItem[]>,
    get: (id: number) =>
      invoke('tasks:get', id) as Promise<TaskItem | undefined>,
    create: (data: {
      projectId: string
      title: string
      description?: string
      priority?: number
      source?: string
      labels?: string[]
      isGlobal?: boolean
    }) => invoke('tasks:create', data) as Promise<TaskItem>,
    update: (
      id: number,
      data: {
        title?: string
        description?: string
        status?: string
        priority?: number
        labels?: string[]
      }
    ) => invoke('tasks:update', id, data) as Promise<TaskItem | undefined>,
    delete: (id: number) => invoke('tasks:delete', id) as Promise<boolean>,
    addAttachment: (taskId: number, filePath?: string) =>
      invoke('tasks:addAttachment', taskId, filePath) as Promise<TaskItem | undefined>,
    removeAttachment: (taskId: number, filePath: string) =>
      invoke('tasks:removeAttachment', taskId, filePath) as Promise<TaskItem | undefined>,
  },

  taskNotes: {
    list: (taskId: number) =>
      invoke('taskNotes:list', taskId) as Promise<TaskNote[]>,
    create: (data: {
      taskId: number
      content: string
      source?: string
      sessionId?: string
    }) => invoke('taskNotes:create', data) as Promise<TaskNote>,
  },

  notes: {
    list: (projectId: string, pinnedOnly?: boolean, isGlobal?: boolean) =>
      invoke('notes:list', projectId, pinnedOnly, isGlobal) as Promise<Note[]>,
    get: (id: number) => invoke('notes:get', id) as Promise<Note | undefined>,
    create: (data: {
      projectId: string
      title: string
      content?: string
      pinned?: boolean
      sessionId?: string
      isGlobal?: boolean
    }) => invoke('notes:create', data) as Promise<Note>,
    update: (
      id: number,
      data: {
        title?: string
        content?: string
        pinned?: boolean
      }
    ) => invoke('notes:update', id, data) as Promise<Note | undefined>,
    delete: (id: number) => invoke('notes:delete', id) as Promise<boolean>,
    search: (projectId: string, query: string, isGlobal?: boolean) =>
      invoke('notes:search', projectId, query, isGlobal) as Promise<Note[]>,
  },

  sessions: {
    list: (projectId: string) =>
      invoke('sessions:list', projectId) as Promise<Session[]>,
    get: (id: string) =>
      invoke('sessions:get', id) as Promise<Session | undefined>,
    create: (data: {
      id: string
      projectId: string
      slug?: string
      startedAt?: string
      model?: string
      gitBranch?: string
      summary?: string
    }) => invoke('sessions:create', data) as Promise<Session>,
    update: (
      id: string,
      data: {
        endedAt?: string
        summary?: string
        messageCount?: number
        toolUseCount?: number
        filesChanged?: string
        inputTokens?: number
        outputTokens?: number
        cacheCreationTokens?: number
        cacheReadTokens?: number
      }
    ) => invoke('sessions:update', id, data) as Promise<Session | undefined>,
    search: (query: string) =>
      invoke('sessions:search', query) as Promise<Session[]>,
    getLiveState: (projectId: string) =>
      invoke('sessions:getLiveState', projectId) as Promise<LiveSessionState | null>,
    findActive: (projectId: string) =>
      invoke('sessions:findActive', projectId) as Promise<{
        sessionId: string
        projectId: string
        filePath: string
        isActive: boolean
        lastActivity: string
      } | null>,
    listRecent: (projectId: string) =>
      invoke('sessions:listRecent', projectId) as Promise<Array<{
        sessionId: string
        projectId: string
        filePath: string
        isActive: boolean
        lastActivity: string
      }>>,
  },

  clients: {
    list: () => invoke('clients:list') as Promise<Client[]>,
    get: (id: string) =>
      invoke('clients:get', id) as Promise<Client | undefined>,
    create: (data: { name: string; color?: string }) =>
      invoke('clients:create', data) as Promise<Client>,
  },

  windows: {
    openProject: (projectId: string) =>
      invoke('window:openProject', projectId) as Promise<{ windowId: number }>,
    closeProject: (projectId: string) =>
      invoke('window:closeProject', projectId) as Promise<void>,
    getProjectWindows: () =>
      invoke('window:getProjectWindows') as Promise<string[]>,
    focusMain: () => invoke('window:focusMain') as Promise<void>,
  },

  dialog: {
    selectFolder: () => invoke('dialog:selectFolder') as Promise<string | null>,
  },

  files: {
    list: (dirPath: string) =>
      invoke('files:list', dirPath) as Promise<
        Array<{ name: string; path: string; isDirectory: boolean; size?: number }>
      >,
    read: (filePath: string) =>
      invoke('files:read', filePath) as Promise<string>,
    write: (filePath: string, content: string) =>
      invoke('files:write', filePath, content) as Promise<void>,
  },

  memory: {
    getDir: (projectPath: string, projectId?: string) =>
      invoke('memory:getDir', projectPath, projectId) as Promise<string>,
    list: (projectPath: string, projectId?: string) =>
      invoke('memory:list', projectPath, projectId) as Promise<
        Array<{ name: string; path: string; isMain: boolean }>
      >,
    read: (filePath: string) =>
      invoke('memory:read', filePath) as Promise<string>,
    write: (filePath: string, content: string) =>
      invoke('memory:write', filePath, content) as Promise<void>,
    delete: (filePath: string) =>
      invoke('memory:delete', filePath) as Promise<void>,
    create: (projectPath: string, fileName: string, projectId?: string) =>
      invoke('memory:create', projectPath, fileName, projectId) as Promise<{
        name: string
        path: string
        isMain: boolean
      }>,
  },

  rules: {
    list: (projectPath: string) =>
      invoke('rules:list', projectPath) as Promise<
        Array<{
          scope: 'global' | 'project' | 'local'
          label: string
          path: string
          exists: boolean
          color: 'blue' | 'purple' | 'orange'
        }>
      >,
    read: (filePath: string) =>
      invoke('rules:read', filePath) as Promise<string>,
    write: (filePath: string, content: string) =>
      invoke('rules:write', filePath, content) as Promise<void>,
    create: (filePath: string, template?: string) =>
      invoke('rules:create', filePath, template) as Promise<void>,
    getMemoryPath: (projectPath: string, projectId?: string) =>
      invoke('rules:getMemoryPath', projectPath, projectId) as Promise<string>,
  },

  services: {
    detect: (projectPath: string) =>
      invoke('services:detect', projectPath) as Promise<
        Array<{
          name: string
          configFile: string
          configPath: string
          dashboardUrl: string | null
          icon: string
        }>
      >,
    listEnvFiles: (projectPath: string) =>
      invoke('services:listEnvFiles', projectPath) as Promise<
        Array<{ name: string; path: string; varCount: number }>
      >,
    readEnvFile: (filePath: string) =>
      invoke('services:readEnvFile', filePath) as Promise<
        Array<{ key: string; value: string; comment?: string }>
      >,
    scanTemplates: (projectPath: string) =>
      invoke('services:scanTemplates', projectPath) as Promise<
        Array<{
          name: string
          path: string
          vars: Array<{ key: string; comment?: string; defaultValue?: string }>
        }>
      >,
  },

  envDoctor: {
    analyze: (projectPath: string) =>
      invoke('env-doctor:analyze', projectPath) as Promise<{
        generatedAt: number
        totalDefinitions: number
        totalUsages: number
        issues: Array<{
          severity: 'error' | 'warning' | 'info'
          code: 'missing' | 'unused' | 'undocumented' | 'suspicious_exposure'
          key: string
          title: string
          evidence: string[]
          remediation: string
        }>
        score: number
      }>,
  },

  images: {
    list: (projectId: string) =>
      invoke('images:list', projectId) as Promise<GeneratedImage[]>,
    get: (id: number) =>
      invoke('images:get', id) as Promise<GeneratedImage | undefined>,
    create: (data: {
      projectId: string
      prompt: string
      filePath: string
      model: string
      responseText?: string
      aspectRatio?: string
      imageSize?: string
      parentImageId?: number
    }) => invoke('images:create', data) as Promise<GeneratedImage>,
    delete: (id: number) =>
      invoke('images:delete', id) as Promise<boolean>,
    generate: (data: {
      projectId: string
      prompt: string
      apiKey: string
      aspectRatio?: string
      imageSize?: string
    }) =>
      invoke('images:generate', data) as Promise<{
        error: string | null
        image: GeneratedImage | null
      }>,
  },

  recordings: {
    list: (projectId: string) =>
      invoke('recordings:list', projectId) as Promise<Recording[]>,
    get: (id: string) =>
      invoke('recordings:get', id) as Promise<Recording | undefined>,
    create: (data: { projectId: string; title: string }) =>
      invoke('recordings:create', data) as Promise<Recording>,
    update: (
      id: string,
      data: {
        title?: string
        duration?: number
        transcript?: string
        status?: string
        errorMessage?: string
      }
    ) => invoke('recordings:update', id, data) as Promise<Recording | undefined>,
    delete: (id: string) =>
      invoke('recordings:delete', id) as Promise<boolean>,
    saveAudio: (id: string, audioData: ArrayBuffer) =>
      invoke('recordings:saveAudio', id, audioData) as Promise<boolean>,
    transcribe: (id: string, apiKey: string) =>
      invoke('recordings:transcribe', id, apiKey) as Promise<Recording>,
  },

  git: {
    status: (projectPath: string) =>
      invoke('git:status', projectPath) as Promise<{
        branch: string
        files: Array<{ status: string; path: string }>
        isClean: boolean
      }>,
    diff: (projectPath: string, options?: { staged?: boolean; file?: string }) =>
      invoke('git:diff', projectPath, options) as Promise<string>,
    log: (projectPath: string, options?: { limit?: number; file?: string }) =>
      invoke('git:log', projectPath, options) as Promise<
        Array<{
          hash: string
          author: string
          email: string
          date: string
          subject: string
          body: string
        }>
      >,
    stage: (projectPath: string, files: string[]) =>
      invoke('git:stage', projectPath, files) as Promise<void>,
    unstage: (projectPath: string, files: string[]) =>
      invoke('git:unstage', projectPath, files) as Promise<void>,
    commit: (projectPath: string, message: string) =>
      invoke('git:commit', projectPath, message) as Promise<{ hash: string }>,
  },

  gmail: {
    listAccounts: () =>
      invoke('gmail:listAccounts') as Promise<GmailAccount[]>,
    authenticate: () =>
      invoke('gmail:authenticate') as Promise<GmailAccount>,
    removeAccount: (accountId: string) =>
      invoke('gmail:removeAccount', accountId) as Promise<{ success: boolean }>,
    listRules: () =>
      invoke('gmail:listRules') as Promise<WhitelistRule[]>,
    addRule: (data: {
      pattern: string
      clientId?: string
      priority?: number
      note?: string
    }) => invoke('gmail:addRule', data) as Promise<WhitelistRule>,
    removeRule: (ruleId: string) =>
      invoke('gmail:removeRule', ruleId) as Promise<{ success: boolean }>,
    pollEmails: (accountId: string) =>
      invoke('gmail:pollEmails', accountId) as Promise<ProcessedEmail[]>,
    listRecentEmails: () =>
      invoke('gmail:listRecentEmails') as Promise<ProcessedEmail[]>,
    getEmailByMessageId: (messageId: string) =>
      invoke('gmail:getEmailByMessageId', messageId) as Promise<ProcessedEmail | null>,
  },

  search: {
    query: (projectId: string, query: string, options?: { limit?: number; types?: string[] }) =>
      invoke('search:query', projectId, query, options) as Promise<
        Array<{
          chunkId: string
          content: string
          symbolName: string | null
          chunkType: string
          filePath: string | null
          startLine: number | null
          endLine: number | null
          score: number
          matchSource: 'fts' | 'vector' | 'hybrid'
        }>
      >,
    reindex: (projectId: string) =>
      invoke('search:reindex', projectId) as Promise<{ success: boolean }>,
    getIndexState: (projectId: string) =>
      invoke('search:getIndexState', projectId) as Promise<{
        projectId: string
        status: string
        lastFullIndexAt: string | null
        totalChunks: number
        lastError: string | null
      } | null>,
    clearIndex: (projectId: string) =>
      invoke('search:clearIndex', projectId) as Promise<{ success: boolean }>,
  },

  shell: {
    showInExplorer: (filePath: string) =>
      invoke('shell:showInExplorer', filePath) as Promise<void>,
  },

  briefing: {
    listDigests: () =>
      invoke('briefing:listDigests') as Promise<BriefingDigest[]>,
    getDigest: (id: number) =>
      invoke('briefing:getDigest', id) as Promise<BriefingDigest | undefined>,
    getItems: (digestId: number) =>
      invoke('briefing:getItems', digestId) as Promise<BriefingItem[]>,
    generate: (projectId: string) =>
      invoke('briefing:generate', projectId) as Promise<BriefingDigest>,
    markRead: (itemId: number) =>
      invoke('briefing:markRead', itemId) as Promise<void>,
    saveItem: (itemId: number) =>
      invoke('briefing:saveItem', itemId) as Promise<void>,
  },

  chat: {
    listConversations: (projectId: string) =>
      invoke('chat:listConversations', projectId) as Promise<ChatConversation[]>,
    getConversation: (id: number) =>
      invoke('chat:getConversation', id) as Promise<ChatConversation | undefined>,
    createConversation: (data: { projectId: string; title: string }) =>
      invoke('chat:createConversation', data) as Promise<ChatConversation>,
    listMessages: (conversationId: number) =>
      invoke('chat:listMessages', conversationId) as Promise<ChatMessage[]>,
    sendMessage: (data: {
      conversationId: number
      role: string
      content: string
      attachments?: ChatAttachment[]
      responseUsage?: TokenUsage | null
      runUsage?: RunUsageSnapshot | null
      provider?: string | null
      model?: string | null
      effortLevel?: ChatEffortLevel | null
      usageCapturedAt?: string | null
    }) =>
      invoke('chat:sendMessage', data) as Promise<ChatMessage>,
    deleteConversation: (id: number) =>
      invoke('chat:deleteConversation', id) as Promise<boolean>,
    providerCompletion: (payload: {
      messages: Array<{ role: string; content: string }>
      model: string
      maxTokens?: number
      effortLevel?: ChatEffortLevel
    }) =>
      invoke('chat:providerCompletion', payload) as Promise<{
        content: string
        usage?: TokenUsage
        providerId?: string
        providerName?: string
      }>,
    streamProviderCompletion: (payload: {
      messages: Array<{ role: string; content: string }>
      model: string
      maxTokens?: number
      effortLevel?: ChatEffortLevel
    }) =>
      invoke('chat:streamProviderCompletion', payload) as Promise<{
        content: string
        usage?: TokenUsage
        providerId?: string
        providerName?: string
      }>,
  },

  agent: {
    start: (payload: {
      conversationId: number
      userMessage: string
      projectId?: string | null
      projectName?: string
      model?: string
      apiKey?: string
      maxIterations?: number
      maxToolCalls?: number
      temperature?: number
      effortLevel?: ChatEffortLevel
      planEnforcement?: boolean
      contextCompaction?: boolean
      attachments?: ChatAttachment[]
    }) => invoke('agent:start', payload) as Promise<{ runId: string }>,
    cancel: (runId?: string) =>
      invoke('agent:cancel', runId) as Promise<{ cancelled: boolean }>,
    continue: (conversationId: number, projectId?: string | null) =>
      invoke('agent:continue', { conversationId, projectId }) as Promise<{ runId: string }>,
    status: () =>
      invoke('agent:status') as Promise<{
        status: 'idle' | 'running'
        runId?: string
        conversationId?: number
        startedAt?: string
      }>,
  },

  provider: {
    listModels: () =>
      invoke('provider:listModels') as Promise<Array<{ id: string; name: string }>>,
    healthCheck: () =>
      invoke('provider:healthCheck') as Promise<{ ok: boolean; latencyMs?: number; error?: string }>,
    startOAuth: (providerId: string) =>
      invoke('provider:startOAuth', providerId) as Promise<{ success: boolean; error?: string; accountIndex?: number; awaitingCode?: boolean }>,
    submitOAuthCode: (providerId: string, code: string) =>
      invoke('provider:submitOAuthCode', providerId, code) as Promise<{ success: boolean; error?: string; accountIndex?: number }>,
    saveDirectToken: (providerId: string, token: string) =>
      invoke('provider:saveDirectToken', providerId, token) as Promise<{ success: boolean; error?: string; accountIndex?: number }>,
    listAccounts: () =>
      invoke('provider:listAccounts') as Promise<
        Array<{
          providerId: string
          accountIndex: number
          accountEmail: string | null
          accountName: string | null
          subscriptionTier: string | null
          expiresAt: number
          isExpired: boolean
          needsRefresh: boolean
        }>
      >,
    removeAccount: (providerId: string, accountIndex?: number) =>
      invoke('provider:removeAccount', providerId, accountIndex) as Promise<{ success: boolean }>,
  },

  update: {
    check: () =>
      invoke('update:check') as Promise<{
        available: boolean
        currentVersion: string
        latestVersion: string | null
        downloadUrl: string | null
        releaseNotes: string | null
      }>,
    download: (url: string) =>
      invoke('update:download', url) as Promise<{ success: boolean; filePath?: string }>,
  },

  settings: {
    get: () => invoke('settings:get') as Promise<AppConfig>,
    set: (config: Partial<AppConfig>) =>
      invoke('settings:set', config) as Promise<{ success: boolean }>,
  },

  browser: {
    clearSession: () => invoke('browser:clearSession') as Promise<{ success: boolean; partition: string }>,
  },

  github: {
    getRepoInfo: (projectPath: string) =>
      invoke('github:getRepoInfo', projectPath) as Promise<{ owner: string; repo: string } | null>,
    listPRs: (owner: string, repo: string, options?: { state?: string; limit?: number }) =>
      invoke('github:listPRs', owner, repo, options) as Promise<any[]>,
    listWorkflows: (owner: string, repo: string, options?: { limit?: number }) =>
      invoke('github:listWorkflows', owner, repo, options) as Promise<any[]>,
    listIssues: (
      owner: string,
      repo: string,
      options?: { state?: string; limit?: number; labels?: string[] }
    ) => invoke('github:listIssues', owner, repo, options) as Promise<any[]>,
  },

  routes: {
    discover: (projectPath: string) =>
      invoke('routes:discover', projectPath) as Promise<{
        framework: string | null
        frameworkVersion?: string
        routes: Array<{
          path: string
          filePath: string
          type: 'static' | 'dynamic' | 'api' | 'catch-all' | 'unknown'
          framework: string
          source: string
        }>
        unsupported: boolean
        generatedAt: number
      }>,
  },

  preview: {
    discover: (
      projectPath: string,
      gitInfo?: { branch: string; isClean: boolean },
      githubInfo?: {
        owner: string
        repo: string
        prs: Array<{
          number: number
          title: string
          head_branch: string
          state: string
        }>
      }
    ) =>
      invoke('preview:discover', projectPath, gitInfo, githubInfo) as Promise<{
        provider: string | null
        currentBranch: string | null
        environments: Array<{
          id: string
          provider: string | null
          branch: string | null
          prNumber: number | null
          prTitle: string | null
          previewUrl: string | null
          productionUrl: string | null
          status: 'active' | 'unknown' | 'manual'
          source: 'config' | 'github' | 'manual'
          commitSha: string | null
          updatedAt: number
        }>
        productionUrl: string | null
      }>,
  },

  designSystem: {
    analyze: (projectPath: string) =>
      invoke('design-system:analyze', projectPath) as Promise<{
        generatedAt: number
        framework: string | null
        tokenCount: number
        tokens: Array<{
          kind: string
          name: string
          value: string
          normalizedValue: string
          namespace: string
          sourceFile: string
          sourceLine: number
          sourceType: string
        }>
        styleStack: string[]
        inconsistencies: Array<{
          kind: string
          title: string
          tokens: string[]
          evidence: string
        }>
      }>,
  },

  componentGraph: {
    analyze: (projectPath: string) =>
      invoke('component-graph:analyze', projectPath) as Promise<{
        generatedAt: number
        totalComponents: number
        totalEdges: number
        nodes: Array<{
          id: string
          name: string
          filePath: string
          exportName: string
          isDefaultExport: boolean
          framework: string
          importCount: number
          renderCount: number
        }>
        edges: Array<{
          fromFile: string
          toFile: string
          fromName: string
          toName: string
          relation: string
        }>
        entryPoints: string[]
      }>,
  },

  launchGuard: {
    run: (inputs: any) => invoke('launch-guard:run', inputs) as Promise<any>,
  },

  contentStudio: {
    generatePack: (inputs: {
      type: string
      pageTitle: string
      pageUrl: string
      domSummary: string
      projectName: string
    }) => invoke('content-studio:generatePack', inputs) as Promise<{
      id: string
      type: string
      title: string
      content: string
      routePath: string | null
      generatedAt: number
    }>,
  },

  visualBaselines: {
    save: (data: {
      projectId: string
      routeKey: string
      pageUrl: string
      viewportWidth: number
      viewportHeight: number
      label?: string
      imageDataUrl: string
    }) => invoke('visual:saveBaseline', data) as Promise<VisualBaseline>,
    list: (projectId: string, routeKey?: string) =>
      invoke('visual:listBaselines', projectId, routeKey) as Promise<VisualBaseline[]>,
    get: (id: number) =>
      invoke('visual:getBaseline', id) as Promise<VisualBaseline | undefined>,
    compare: (data: {
      baselineId: number
      projectId: string
      currentImageDataUrl: string
    }) =>
      invoke('visual:compare', data) as Promise<{
        comparison: VisualComparison
        baselineDataUrl: string
        currentDataUrl: string
        diffDataUrl: string
        error?: string
      }>,
    approve: (data: { comparisonId: number; baselineId: number }) =>
      invoke('visual:approveBaseline', data) as Promise<{ success?: boolean; error?: string }>,
    delete: (id: number) =>
      invoke('visual:deleteBaseline', id) as Promise<boolean>,
  },
}
