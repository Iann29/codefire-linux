# Project Intelligence Layer Plan

> **Date:** 2026-03-09
> **Status:** OPEN
> **Vision Level:** 11/10
> **Scope:** agent context, retrieval, browser/runtime evidence, project knowledge, working-set intelligence
> **Primary Goal:** evolve Pinyino from a code index + tool runner into a real-time project intelligence system that prepares the best possible context before the model starts burning tokens
> **Primary Non-goal:** incremental UI polish without changing the underlying intelligence model

---

## Executive Summary

`Indexed` is a good idea, but it is still the idea of a search engine.

It answers questions like:

- what files exist?
- which code chunks look relevant?
- where does this symbol appear?

That is useful.

It is not the final form.

The real opportunity for Pinyino is to stop thinking in terms of **indexing files** and start thinking in terms of **maintaining a live model of the project**.

That model should not be limited to code chunks in SQLite. It should continuously combine:

- filesystem truth
- code relationships
- runtime/browser evidence
- project memory and rules
- chat/session working set
- task intent

The result is not “better search”.

The result is a **Project Intelligence Layer**: a system that assembles the smallest, freshest, highest-confidence evidence pack for the current task before the provider starts doing expensive reasoning.

This is the path from “good internal agent IDE” to something meaningfully stronger than a plain Claude Code style workflow for web-development tasks.

---

## Why `Indexed` Is Only 8/10

The current `Indexed` system is real and useful.

It already has a valid base:

- project chunking and index state in [ContextEngine.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/ContextEngine.ts)
- hybrid search over indexed chunks in [SearchEngine.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/SearchEngine.ts)
- semantic tools like `find_symbol` / `find_related_files` in [CodebaseToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/codebase/CodebaseToolService.ts)
- graph-backed code relationships in [ReferenceGraphService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/codebase/ReferenceGraphService.ts)
- project-scoped file truth in [FileToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/files/FileToolService.ts)
- browser/runtime entrypoint in [BrowserBridge.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/BrowserBridge.ts)
- preview, routes, env, launch and design services already living in:
  - [PreviewDiscoveryService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/PreviewDiscoveryService.ts)
  - [RouteDiscoveryService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/routes/RouteDiscoveryService.ts)
  - [EnvDoctorService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/EnvDoctorService.ts)
  - [LaunchGuardService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/launch-guard/LaunchGuardService.ts)
  - [DesignSystemService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/design-system/DesignSystemService.ts)

So the weakness is not “there is no intelligence”.

The weakness is that the intelligence is still fragmented.

Today the app still behaves too often like:

1. user asks something
2. model starts from near-zero
3. model brute-forces tool calls
4. model slowly reconstructs context that the app should already know

That is exactly where token waste, latency, repeated `grep_files`, repeated `read_file`, and annoying permission prompts start to explode.

The system is still too reactive.

The 11/10 version becomes proactive.

---

## Core Thesis

Pinyino should replace the product concept of **Indexed** with the product concept of **Intelligence**.

The user should not have to think:

- am I in indexed mode?
- am I in filesystem mode?

The user should think:

- does the agent have enough context?
- how fresh is that context?
- where did that evidence come from?

This implies a new top-level abstraction:

## The Project Intelligence Layer

The Project Intelligence Layer is a continuously refreshed, source-aware model of the current project and current task.

Its job is to answer one question:

> What does the agent need to know right now, with the highest confidence and the lowest token/tool cost?

---

## The Six Layers Of Intelligence

### 1. Filesystem Truth

This is the hard ground truth of the workspace.

It includes:

- files and directories
- hashes
- file sizes / mtimes
- dirty files
- changed files vs git
- project root boundaries
- symlink safety

Current anchors:

- [FileToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/files/FileToolService.ts)
- [GitService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/GitService.ts)
- [ProjectDiscovery.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/ProjectDiscovery.ts)

This layer answers:

- what objectively exists?
- what changed recently?
- what is safe to read or edit?

### 2. Code Graph

This is the structural model of code relationships.

It includes:

- imports / exports
- symbol definitions
- references
- related tests
- related styles
- route entrypoints
- component graph
- file companions

Current anchors:

- [ReferenceGraphService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/codebase/ReferenceGraphService.ts)
- [CodebaseToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/codebase/CodebaseToolService.ts)
- [ContextEngine.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/ContextEngine.ts)
- [RouteDiscoveryService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/routes/RouteDiscoveryService.ts)

This layer answers:

- where does this feature actually live?
- what files participate in the same behavior?
- what is likely to break if this changes?

### 3. Runtime Graph

This is the live evidence from the browser and runtime environment.

It includes:

- current page URL and title
- navigation history
- console errors
- failed network requests
- screenshots
- responsive state
- form detections
- runtime DOM findings
- browser session status

Current anchors:

- [BrowserBridge.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/BrowserBridge.ts)
- [BrowserView.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/views/BrowserView.tsx)
- [ServicesView.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/views/ServicesView.tsx)

This layer answers:

- what is happening right now in the running app?
- what evidence do we already have from the browser without asking the model to rediscover it?

### 4. Project Knowledge

This is the durable non-code knowledge of the project.

It includes:

- memory files
- rules
- prompt policy
- env expectations
- service configuration
- launch criteria
- design system conventions
- team-specific patterns

Current anchors:

- [MemoryView.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/views/MemoryView.tsx)
- [RulesView.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/views/RulesView.tsx)
- [EnvDoctorService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/EnvDoctorService.ts)
- [LaunchGuardService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/launch-guard/LaunchGuardService.ts)
- [DesignSystemService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/design-system/DesignSystemService.ts)

This layer answers:

- what is expected here?
- what are the project’s constraints and conventions?

### 5. Session Working Set

This is the short-lived working memory for the current conversation or task.

It includes:

- files already read
- evidence already collected
- tools already attempted
- failures already observed
- active hypotheses
- pending edits
- attachments sent by the user
- browser evidence already attached to the chat

Current anchors:

- [CodeFireChat.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/components/Chat/CodeFireChat.tsx)
- [SessionParser.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/SessionParser.ts)
- [LiveSessionWatcher.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/LiveSessionWatcher.ts)
- [SessionsView.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/views/SessionsView.tsx)

This layer answers:

- what does the agent already know in this session?
- what should not be fetched again?
- what evidence has become stale?

### 6. Task Intent Model

This is the routing layer that determines what kind of work the user is asking for.

It includes task categories like:

- explain
- locate
- refactor
- debug browser issue
- validate responsive behavior
- audit launch readiness
- inspect env drift
- compare previews

Current anchors:

- [ToolRegistry.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/ToolRegistry.ts)
- [ProviderRouter.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/providers/ProviderRouter.ts)

This layer answers:

- what retrieval path should run first?
- what evidence matters most for this task?
- which tools should be deprioritized or hidden?

---

## The Real Innovation

The innovation is not “better code search”.

The innovation is **retrieval orchestration before reasoning**.

Today most coding agents work like this:

1. read prompt
2. think
3. call tools repeatedly
4. reconstruct context
5. finally answer or edit

The Project Intelligence Layer changes the order:

1. classify intent
2. assemble evidence from existing layers
3. score freshness and confidence
4. create a compact evidence pack
5. give the model a strong starting state
6. use tools only to deepen, not to bootstrap

That sounds subtle, but it changes everything:

- fewer tool calls
- lower token burn
- faster time to first good answer
- fewer stupid loops
- fewer repeated reads
- fewer “permission” or “confirm” interruptions
- better chat continuity
- better debugging quality

This is the path to feeling more powerful than “Claude Code in a shell”.

---

## The Evidence Pack

The heart of the system should be a new artifact:

## `EvidencePack`

This is what the model should receive before it starts brute-forcing tools.

Proposed shape:

```ts
type EvidencePack = {
  taskIntent: 'explain' | 'edit' | 'debug-browser' | 'audit' | 'deploy' | 'unknown'
  confidence: number
  freshness: {
    filesystem: 'fresh' | 'stale' | 'unknown'
    codeGraph: 'fresh' | 'stale' | 'unknown'
    runtime: 'fresh' | 'stale' | 'missing'
    projectKnowledge: 'fresh' | 'stale' | 'unknown'
    workingSet: 'fresh' | 'stale' | 'unknown'
  }
  candidateEntrypoints: Array<{
    path: string
    reason: string
    score: number
  }>
  relatedFiles: Array<{
    path: string
    relation: string
    score: number
  }>
  browserEvidence: {
    url?: string
    consoleErrors?: string[]
    networkFailures?: string[]
    screenshotIds?: string[]
  }
  projectConstraints: {
    rules: string[]
    memoryFacts: string[]
    envWarnings: string[]
  }
  gitContext: {
    changedFiles: string[]
    branch?: string
  }
  sessionContext: {
    filesAlreadyRead: string[]
    attachmentsInContext: string[]
    priorFindings: string[]
  }
}
```

This must become the main unit of agent context assembly.

---

## Example: Why This Is Better

### Current experience

User asks:

> why is the login page broken?

The model often does:

- `grep_files`
- `glob_files`
- `read_file`
- `read_file`
- `read_file_range`
- `grep_files`
- `read_file`
- browser tool
- more reads

This is slow and dumb.

### Project Intelligence Layer flow

Before the provider reasons, the system prepares:

- likely route entrypoint: `app/login/page.tsx`
- likely form component: `components/auth/LoginForm.tsx`
- related server or service file
- relevant recent changed files from git
- browser console errors on the current page
- failed login network requests
- rule or memory notes about auth
- freshness/confidence score

Then the model starts from a real base.

Now the first move is not a blind `grep`.
It is a targeted explanation or a single precise read.

That is the difference between “tool user” and “project brain”.

---

## Product-Level Change

This is not just a backend refactor.

It changes the product language.

### Replace the concept of `Indexed`

`Indexed` is too implementation-oriented.

It describes how the system works internally, not what the user gets.

Better top-level labels:

- `Intelligence`
- `Project Brain`
- `Context`
- `Live Context`

### UI direction

Instead of showing only:

- indexed vs not indexed

the product should eventually show:

- intelligence readiness
- freshness status
- working-set size
- browser/runtime evidence attached
- changed-files awareness
- confidence level for current answer

This reframes the product around user value instead of storage mechanics.

---

## Target Architecture

Create a dedicated orchestration layer:

- `src/main/services/intelligence/ProjectIntelligenceService.ts`
- `src/main/services/intelligence/EvidencePackBuilder.ts`
- `src/main/services/intelligence/WorkingSetService.ts`
- `src/main/services/intelligence/IntentClassifier.ts`
- `src/main/services/intelligence/FreshnessTracker.ts`

### `ProjectIntelligenceService`

Responsibilities:

- coordinate all intelligence layers
- answer “what evidence should we prepare now?”
- expose snapshot APIs for chat, browser, and task flows

### `EvidencePackBuilder`

Responsibilities:

- gather evidence from all layers
- deduplicate overlapping facts
- score confidence
- compress context into model-friendly output

### `WorkingSetService`

Responsibilities:

- track per-conversation file reads
- track tool outcomes
- track attachments and screenshots in active context
- mark stale session evidence after edits/navigation

### `IntentClassifier`

Responsibilities:

- infer task category from user message + UI state
- choose default retrieval strategy
- suppress irrelevant tools when possible

### `FreshnessTracker`

Responsibilities:

- know when filesystem, index, graph, browser, or session evidence is stale
- invalidate aggressively after edits, navigation, or git changes

---

## Retrieval Strategy Hierarchy

The system should stop treating all retrieval routes as equal.

Proposed order:

### Level 0. Existing session evidence

Use first if confidence is high.

- previously read files
- browser evidence already attached
- recent findings from the same conversation

### Level 1. Structural intelligence

Use second.

- route discovery
- reference graph
- related files
- changed files
- symbol map

### Level 2. Semantic index

Use third.

- chunk search
- indexed symbol lookup
- fuzzy related-file recovery

### Level 3. Raw filesystem

Use last.

- grep
- glob
- tree
- full-file reads

This is critical.

Right now the system too often jumps down to Level 3 too early.

---

## Strategic Differentiators

If executed well, this plan gives Pinyino a few strong differentiators.

### 1. Browser + Code + Chat are one intelligence loop

Most coding agents still keep these worlds loosely coupled.

Pinyino can fuse:

- browser observations
- code topology
- session context
- rules/memory

into one retrieval system.

### 2. Working-set awareness

Most tools do not know what the model already saw.

Pinyino can avoid re-reading and re-paying for context.

### 3. Freshness-aware answers

An answer should be able to say, internally or eventually in UI:

- based on fresh browser evidence
- based on stale index
- based on current git state

That is a serious trust upgrade.

### 4. Intent-driven tool routing

The system should not offer the same behavior for:

- “explain this component”
- “fix this runtime bug”
- “audit this deploy”

Tool routing should adapt.

### 5. Evidence-first reasoning

This is the deepest differentiator.

Do not make the model rediscover what the product can already know.

---

## Phased Delivery

## Phase 1. Reframe `Indexed` Into Intelligence Foundations

### Goals

- stop auto-full-reindex as the only story
- make freshness visible
- establish the intelligence vocabulary

### Work

- add `ProjectIntelligenceService`
- wrap current index state into a broader intelligence snapshot
- keep `ContextEngine` as one source, not the whole feature
- stop forcing full reindex on every open in [ProjectLayout.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/layouts/ProjectLayout.tsx)

### Outcome

The product stops equating intelligence with chunk count.

## Phase 2. Working Set + Intent Routing

### Goals

- stop repeated brute-force retrieval
- adapt retrieval to task type

### Work

- add `WorkingSetService`
- add `IntentClassifier`
- attach evidence pack generation to chat turn creation in [CodeFireChat.tsx](/home/ian/Documents/projects/codefire-app/electron/src/renderer/components/Chat/CodeFireChat.tsx)
- route tool recommendations through [ToolRegistry.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/ToolRegistry.ts)

### Outcome

The agent starts with better context and uses fewer raw tools.

## Phase 3. Runtime Graph Integration

### Goals

- make browser evidence first-class context

### Work

- expose structured browser evidence snapshots from [BrowserBridge.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/BrowserBridge.ts)
- connect current page state, console errors, network failures, screenshot artifacts and responsive state to the evidence pack
- mark runtime evidence stale on navigation or browser reset

### Outcome

The browser stops being a separate toy surface and becomes part of agent reasoning.

## Phase 4. Project Knowledge Fusion

### Goals

- make rules/memory/env/design/launch usable without brute-force prompting

### Work

- normalize project memory and rules into intelligence facts
- ingest env and launch diagnostics from:
  - [EnvDoctorService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/EnvDoctorService.ts)
  - [LaunchGuardService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/launch-guard/LaunchGuardService.ts)
  - [DesignSystemService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/design-system/DesignSystemService.ts)

### Outcome

Project conventions become retrieval inputs, not only static tabs.

## Phase 5. Trust, Telemetry, and UX Surfacing

### Goals

- prove the system works
- make it inspectable

### Work

- emit evidence-pack metrics
- compare tool-call counts before/after
- surface freshness/confidence in the context tab
- expose why the system picked certain files or evidence

### Outcome

The intelligence system becomes measurable and debuggable.

---

## What “Done” Looks Like

This vision is successful when all of the following are true:

- the median “time to first relevant file” drops materially
- the agent uses fewer brute-force file tools on common tasks
- browser-debug tasks start with browser evidence already attached
- chat turns remember what was already explored
- freshness and confidence are inspectable
- users feel the agent starts from understanding instead of starting from amnesia

The emotional bar matters too.

The system should feel like:

- “it already understands the project”

not:

- “it is about to grep my repo 17 times”

---

## Risks

### Risk 1. Overbuilding a giant intelligence layer that becomes slow

Mitigation:

- keep each layer independently cacheable
- compute evidence packs incrementally
- avoid full recomputation for every turn

### Risk 2. Hidden staleness

Mitigation:

- explicit freshness metadata everywhere
- aggressive invalidation after writes, navigation, and git changes

### Risk 3. Too much magic, not enough inspectability

Mitigation:

- expose evidence sources in the context tab
- show why files were chosen
- preserve drill-down for advanced users

### Risk 4. Duplicating existing systems instead of orchestrating them

Mitigation:

- treat current services as intelligence sources
- do not rebuild route/env/design/browser analysis from scratch

---

## Recommended Next Step

Do not start by rewriting everything.

The right first implementation step is:

1. create `ProjectIntelligenceService`
2. define `EvidencePack`
3. implement `IntentClassifier`
4. build a first evidence pack from:
   - changed files
   - reference graph
   - indexed symbol/related-file lookup
   - memory/rules summary
   - current browser snapshot when available
5. inject that evidence pack into the chat turn before the provider call

That is the first moment when this vision becomes real.

---

## Final Position

`Indexed` is not wrong.

It is just too small a concept for what Pinyino can become.

The 11/10 version is not “a better index”.

It is a **Project Intelligence Layer** that continuously answers:

> what does the agent need to know right now, with the best freshness, the highest confidence, and the least wasted effort?

That is the real moat.
