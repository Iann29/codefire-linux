# Agent Codebase Tools 10/10 Completion Plan

> **Date:** 2026-03-09
> **Status:** OPEN
> **Scope:** agent workspace/codebase/web-dev tooling
> **Baseline:** ~8/10 after the current file, git, safe-editing, and semantic wave
> **Objective:** close the remaining gap so the Pinyino agent can operate on real web projects at a level comparable to Claude Code/Codex for codebase understanding, safe refactoring, and web project diagnosis
> **Non-goals:** chat UI, browser UI, MCP, model/provider settings, generic product polish outside the agent tooling stack

---

## Executive Summary

The agent tooling is no longer primitive.

It already has:

- project-scoped file reads
- batch/range/glob/grep retrieval
- safe editing with checksum guards
- changed-files discovery
- first-pass semantic lookup via `find_symbol`
- first-pass related-file discovery via `find_related_files`

That is enough to call the current surface **good**.

It is not enough to call it **10/10**.

The remaining gap is now concentrated in five areas:

1. **tool runtime architecture** is still too concentrated in `AgentService`
2. **semantic understanding** still lacks a real reference/import graph
3. **web-dev bridge tools** exist as services but are not agent tools yet
4. **edit workflow maturity** still lacks dry-run/diff-preview ergonomics and richer patch operations
5. **observability/evals** are not yet strong enough to prove the agent is actually using the new surface optimally

The right way to finish this is not to spray more tools into `AgentService`.

The right way is to make one disciplined final wave:

- extract the tool runtime
- add graph-backed semantic tools
- wrap the existing web-analysis services as agent tools
- harden edit workflows
- add evals and usage telemetry

If that wave is done well, the result is not “more tools”.

It becomes a coherent **agent operating system for web projects**.

---

## Current Baseline

### Implemented Already

The current baseline is materially better than the original filesystem-only surface.

#### File primitives

- `FileToolService` now exists in [FileToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/files/FileToolService.ts)
- it already covers:
  - `read_file`
  - `read_file_range`
  - `read_many_files`
  - `list_files`
  - `get_file_info`
  - `get_directory_tree`
  - `glob_files`
  - `grep_files`

#### Safe editing

- the first safe-editing layer is already in [FileToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/files/FileToolService.ts)
- it already covers:
  - `write_file`
  - `apply_file_patch`
  - `move_path`
- this layer already enforces:
  - project scoping
  - stale-write protection by checksum
  - symlink escape blocking

#### Git workflow

- `list_changed_files` already exists in [GitService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/GitService.ts)
- it already supports:
  - `working_tree`
  - `staged`
  - `branch_diff`

#### Semantic layer v1

- `CodebaseToolService` already exists in [CodebaseToolService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/tools/codebase/CodebaseToolService.ts)
- it already provides:
  - `find_symbol`
  - `find_related_files`

#### Agent integration

- the tool schemas and execution wiring still live in [AgentService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/AgentService.ts)

### Why this is 8/10 and not 10/10

Because the current agent can:

- find definitions
- read targeted code
- make safe edits
- scope work to changed files

But it still cannot do the following with first-class confidence:

- answer “who imports/uses this?” with a graph-backed result
- trace a feature across route -> component -> style -> env -> preview/deploy concerns
- use the app’s existing project-analysis services as native tools
- operate with mature edit previews and richer patch semantics
- prove via telemetry/evals that the new tools reduce tool-call count and token waste in real tasks

---

## Definition Of 10/10

This plan is done only when all of the following are true.

### Capability bar

The agent can handle these classes of requests without brute-force loops:

- locate a symbol definition
- locate symbol usages/importers/references
- find related tests, stories, styles, and route entrypoints
- discover route topology of the project
- inspect the project’s design system and token inconsistencies
- audit environment-variable definitions vs code usage
- summarize launch/deploy readiness
- discover preview environments
- perform multi-file safe refactors with guarded edits

### Quality bar

Across a benchmark suite of representative web-project tasks:

- median tool calls until the first relevant file is **<= 4**
- median full-file reads per task are **meaningfully lower** than the current baseline
- stale-write protection catches conflicting edits **100%** of the time
- path escape attempts remain **0 successful**
- semantic/bridge tools are preferred over brute-force file scanning in the majority of matching tasks

### Architecture bar

- `AgentService` is no longer the monolith for every tool concern
- tool definitions, contracts, and execution policy are separated from run orchestration
- new tools can be added without expanding one giant switch statement indefinitely

---

## Workstreams

## 1. Tool Runtime Extraction

### Why this is mandatory

Even after the recent work, `AgentService` is still carrying too much:

- tool schema
- tool execution switch
- prompt policy
- run orchestration
- event emission

That is acceptable at 8/10.

It is not acceptable at 10/10.

### Deliverables

Create a dedicated tool runtime layer:

- `src/main/services/tools/ToolContracts.ts`
- `src/main/services/tools/ToolRegistry.ts`
- `src/main/services/tools/ToolExecutionContext.ts`
- `src/main/services/tools/ToolResult.ts`

### Target design

Each tool should be represented by a stable definition:

- `name`
- `description`
- `schema`
- `category`
- `safetyLevel`
- `execute(context, args)`

The registry should:

- expose the tool list to providers
- route execution by tool name
- centralize validation and output normalization
- keep `AgentService` focused on the run loop

### Acceptance criteria

- `AgentService` no longer owns the full tool schema array inline
- `AgentService` no longer grows by adding large `case` blocks for every new tool
- adding one new tool means editing one registry surface, not multiple scattered locations

---

## 2. Semantic Intelligence 2.0

### Why this is mandatory

The current semantic layer is useful, but still first-pass.

`find_symbol` is definition-oriented.
`find_related_files` is heuristic.

To reach 10/10, the agent needs a real **code relationship layer**.

### New services

Create:

- `src/main/services/tools/codebase/ReferenceGraphService.ts`

### Implementation strategy

#### Tier 1: TypeScript/JavaScript projects

Use the TypeScript compiler API where possible to build:

- import graph
- export graph
- symbol-to-file mapping
- file-to-file dependency mapping

Support:

- `tsconfig.json`
- `jsconfig.json`
- path aliases
- relative imports
- `index` file resolution

#### Tier 2: fallback mode

For projects without usable TypeScript program setup:

- use the existing indexed file list
- use regex/import scanning heuristics
- be explicit in metadata when results are heuristic instead of compiler-resolved

### New tools

#### `find_references`

Find places where a symbol is imported, re-exported, or used.

Inputs:

- `symbol`
- `path?`
- `limit?`

Outputs:

- usage file
- line
- relation kind
- confidence/source

#### `find_importers`

Given a file or symbol, return upstream files that depend on it.

Inputs:

- `path?`
- `symbol?`
- `limit?`

#### `find_exports`

Return exported symbols from a file, with export kind and line range.

Inputs:

- `path`

#### `find_test_companions`

Given a file or symbol, return likely tests/specs/stories/fixtures.

Inputs:

- `path?`
- `symbol?`
- `limit?`

#### `find_style_companions`

Given a component/page file, return likely CSS/module/Sass/Tailwind-related files.

Inputs:

- `path`
- `limit?`

### Acceptance criteria

- the agent can answer “where is this used?” without brute-force grep loops in common TS/JS web projects
- path aliases resolve correctly in common Next/Vite setups
- results clearly label `compiler`, `graph`, or `heuristic` origin

---

## 3. Web-Dev Bridge Tools

### Why this is mandatory

This repository already contains strong analysis services outside the agent tool surface.

That is unused leverage.

To reach 10/10, the agent must stop pretending those capabilities do not exist.

### Existing services to wrap

- [RouteDiscoveryService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/routes/RouteDiscoveryService.ts)
- [DesignSystemService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/design-system/DesignSystemService.ts)
- [EnvDoctorService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/EnvDoctorService.ts)
- [ComponentGraphService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/component-graph/ComponentGraphService.ts)
- [LaunchGuardService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/launch-guard/LaunchGuardService.ts)
- [PreviewDiscoveryService.ts](/home/ian/Documents/projects/codefire-app/electron/src/main/services/PreviewDiscoveryService.ts)

### New wrapper service

Create:

- `src/main/services/tools/codebase/WebProjectToolService.ts`

### New tools

#### `discover_routes`

Wrap `RouteDiscoveryService`.

Should return:

- framework
- route list
- route type
- source file
- unsupported state

#### `inspect_design_system`

Wrap `DesignSystemService`.

Should return:

- style stack
- token summary
- major inconsistencies
- top token namespaces

#### `env_doctor`

Wrap `EnvDoctorService`.

Should return:

- score
- issue summary
- missing vars
- suspicious exposure
- unused vars

#### `component_usage`

Wrap `ComponentGraphService`.

Should support:

- by component name
- by file path

Should return:

- imports
- render edges
- entry points
- hot spots

#### `launch_guard_summary`

Compose:

- `git_status`
- `env_doctor`
- `discover_routes`
- `LaunchGuardService`

This should produce a concise deploy-readiness report the agent can use directly.

#### `discover_previews`

Wrap `PreviewDiscoveryService`.

Should return:

- provider
- current branch
- inferred preview environments
- inferred production URL

### Acceptance criteria

- for route/design/env/component/deploy questions, the agent reaches the relevant answer using a bridge tool before falling back to raw file exploration
- outputs are concise enough to be LLM-friendly, but structured enough to chain into follow-up tools

---

## 4. Edit Workflow Maturity

### Why this is mandatory

The current editing layer is safe enough to be useful.

It is not yet ergonomic enough to be 10/10.

### Required upgrades

#### `apply_file_patch` v2

Extend patch operations to support:

- `replace_exact`
- `insert_before`
- `insert_after`
- `replace_line_range`

Each operation must preserve:

- `expectedChecksum`
- exact match counts
- deterministic ordering

#### Dry-run mode

Add `dryRun` support for:

- `write_file`
- `apply_file_patch`
- `move_path`

Dry-run should return:

- `wouldApply`
- `diffSummary`
- `checksumBefore`
- `checksumAfter`

without mutating disk.

#### Better stale-state ergonomics

When a checksum mismatch happens, the tool should return:

- current checksum
- concise mismatch explanation
- suggested recovery tools

Example hints:

- `read_file`
- `read_file_range`
- `git_diff`

### Explicit non-goals for this wave

Do **not** add:

- arbitrary delete tools
- binary patching
- project-external writes

Those are not required for 10/10 in this domain and would create unnecessary risk.

---

## 5. Prompt Routing And Tool Policy

### Why this is mandatory

A great tool surface is wasted if the model keeps using the wrong tools.

### Required prompt policies

Update the agent instructions so they strongly prefer:

- `find_symbol` before `grep_files` for definition lookup
- `find_references` / `find_importers` before brute-force text search for usage questions
- `find_related_files` before `list_files` for companion discovery
- `list_changed_files` before broad exploration for review/refactor-on-delta tasks
- web bridge tools before raw reads for route/design/env/deploy questions
- `apply_file_patch` before `write_file` for existing-file edits
- `write_file` mainly for new files or intentional full rewrites

### Acceptance criteria

- prompts do not encourage brute-force reads when a semantic or bridge tool exists
- benchmark traces show the model actually changes behavior

---

## 6. Observability, Telemetry, And Evals

### Why this is mandatory

Without measurement, “10/10” is a feeling.

This wave needs proof.

### Required telemetry

Per run, capture:

- tool name
- latency
- success/failure
- payload size
- result size
- whether the tool was a semantic/bridge/basic tool

Add metrics such as:

- `avg_tool_calls_per_task`
- `avg_full_file_reads_per_task`
- `avg_prompt_tokens_before_first_relevant_edit`
- `semantic_tool_adoption_rate`
- `bridge_tool_adoption_rate`
- `stale_write_block_count`
- `path_escape_block_count`

### Required eval suite

Create a benchmark set of real tasks:

1. find a component definition
2. find all usages/importers of a hook
3. locate test/story/style companions
4. scope a refactor to changed files only
5. discover all app routes
6. explain the design-token source of a color
7. diagnose a missing env var
8. summarize launch readiness
9. infer preview URL/provider
10. perform a multi-file guarded refactor

### Runtime note

Database-backed tests touching `better-sqlite3` must be runnable in the compatible runtime.

Document and support:

- `npm run build`
- `npm run test -- <non-db suites>`
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run <db suites>`

If possible, add a dedicated script for the Electron-compatible DB test path so the workflow is not tribal knowledge.

---

## Recommended Execution Order

## Phase 1. Architecture Extraction

- extract tool runtime contracts/registry
- no product behavior change yet

## Phase 2. Semantic Graph

- `ReferenceGraphService`
- `find_references`
- `find_importers`
- `find_exports`
- companion-file tools

## Phase 3. Bridge Tools

- `discover_routes`
- `inspect_design_system`
- `env_doctor`
- `component_usage`
- `launch_guard_summary`
- `discover_previews`

## Phase 4. Edit Workflow Maturity

- dry-run
- richer patch ops
- better stale recovery hints

## Phase 5. Prompt + Telemetry + Evals

- prompt routing updates
- metrics
- benchmark suite
- regression guardrails

---

## Recommended Parallelization For Agents

### Worker A: Tool Runtime

Own:

- `AgentService.ts`
- new `ToolRegistry` / contracts files

Goal:

- extract tool runtime without changing behavior

### Worker B: Semantic Graph

Own:

- `ChunkDAO.ts`
- new `ReferenceGraphService.ts`
- semantic-tool tests

Goal:

- imports/exports/references/companions

### Worker C: Bridge Tools

Own:

- `WebProjectToolService.ts`
- wrappers for route/design/env/component/launch/preview tools

Goal:

- expose existing analysis services as agent tools

### Worker D: Edit Maturity + Telemetry

Own:

- `FileToolService.ts`
- telemetry/eval tests
- helper scripts for Electron-compatible DB test runs

Goal:

- dry-run, richer patch semantics, observability

This split keeps write scopes mostly disjoint and avoids every worker fighting over the same section of `AgentService`.

---

## Acceptance Criteria

The plan is complete only if all of these are true:

- `AgentService` is no longer the long-term home of raw tool schema and execution sprawl
- graph-backed symbol/reference/import tooling exists and works on common TS/JS web projects
- web analysis services are first-class agent tools
- edit tools support dry-run and richer patch workflows without weakening safety
- tool outputs stay stable and structured
- benchmark tasks demonstrate fewer brute-force reads and fewer unnecessary tool calls
- build passes
- DB-backed semantic tests pass in the supported Electron-compatible runtime

---

## Risks And Mitigations

### Risk: fake semantic confidence

If reference/import data is heuristic but presented as authoritative, the tool becomes dangerous.

Mitigation:

- label result origin explicitly:
  - `compiler`
  - `graph`
  - `heuristic`

### Risk: registry refactor breaks existing tools

Mitigation:

- Phase 1 must be behavior-preserving
- add snapshot/golden coverage for tool schema outputs

### Risk: bridge tools return too much data

Mitigation:

- all bridge tools must return summaries plus capped item lists
- provide follow-up hints for deeper inspection

### Risk: edit tools become too permissive

Mitigation:

- keep checksum requirements
- keep project scoping
- keep destructive deletion out of scope

---

## Final Recommendation

Do **not** treat the remaining gap as “just add more tools”.

Treat it as the final architecture + semantics wave.

The correct target is:

- generic filesystem and git tools for low-level work
- graph-backed semantic tools for code understanding
- bridge tools for web-project intelligence
- safe edit workflows for real refactors
- telemetry and evals to prove it all works

That is the shortest path from **8/10** to a real **10/10**.
