/**
 * Agent Tool Eval Suite
 *
 * Validates the 10 representative agent tool tasks by testing tool definitions,
 * registry behavior, and tool execution contracts in pure Node.js.
 *
 * No database, Electron, or filesystem dependencies required -- all tools are
 * registered as mock definitions with the same names, schemas, and categories
 * as the real ones.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../../main/services/tools/ToolRegistry'
import type { ToolCategory } from '../../main/services/tools/ToolContracts'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolSchema,
  ProviderToolSchema,
} from '../../main/services/tools/ToolContracts'

// ---------------------------------------------------------------------------
// Mock tool definition builder
// ---------------------------------------------------------------------------

function mockTool(
  name: string,
  category: ToolCategory,
  schema: ToolSchema,
  safetyLevel: ToolDefinition['safetyLevel'] = 'safe',
): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    schema,
    category,
    safetyLevel,
    execute: async (_ctx: ToolExecutionContext, _args: Record<string, unknown>) =>
      JSON.stringify({ mock: true }),
  }
}

function objSchema(
  properties: ToolSchema['properties'],
  required?: string[],
): ToolSchema {
  return { type: 'object', properties, required }
}

// ---------------------------------------------------------------------------
// Full mock definitions mirroring the real tool catalog
// ---------------------------------------------------------------------------

function createAllMockTools(): ToolDefinition[] {
  return [
    // =================== Data tools (task, note, session, project) ===================
    mockTool('list_tasks', 'task', objSchema({
      status: { type: 'string', description: 'Filter tasks by status.' },
    })),
    mockTool('create_task', 'task', objSchema({
      title: { type: 'string', description: 'Task title.' },
      description: { type: 'string', description: 'Task description.' },
      priority: { type: 'number', description: 'Task priority.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Task labels.' },
    }, ['title'])),
    mockTool('update_task', 'task', objSchema({
      id: { type: 'number', description: 'Task ID.' },
      title: { type: 'string', description: 'New title.' },
      description: { type: 'string', description: 'New description.' },
      status: { type: 'string', description: 'New status.' },
      priority: { type: 'number', description: 'New priority.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'New labels.' },
    }, ['id'])),
    mockTool('list_notes', 'note', objSchema({
      pinned_only: { type: 'boolean', description: 'Only show pinned notes.' },
    })),
    mockTool('create_note', 'note', objSchema({
      title: { type: 'string', description: 'Note title.' },
      content: { type: 'string', description: 'Note content.' },
      pinned: { type: 'boolean', description: 'Pin the note.' },
    }, ['title', 'content'])),
    mockTool('search_notes', 'note', objSchema({
      query: { type: 'string', description: 'Search query.' },
    }, ['query'])),
    mockTool('list_sessions', 'session', objSchema({})),
    mockTool('search_sessions', 'session', objSchema({
      query: { type: 'string', description: 'Search query.' },
    }, ['query'])),
    mockTool('list_projects', 'project', objSchema({})),

    // =================== Git tools ===================
    mockTool('git_status', 'git', objSchema({})),
    mockTool('git_log', 'git', objSchema({
      limit: { type: 'number', description: 'Number of commits to return.' },
    })),
    mockTool('git_diff', 'git', objSchema({
      staged: { type: 'boolean', description: 'Show staged changes only.' },
    })),
    mockTool('list_changed_files', 'git', objSchema({
      scope: { type: 'string', enum: ['working_tree', 'staged', 'branch_diff'], description: 'Change scope.' },
      limit: { type: 'number', description: 'Maximum number of files to return.' },
    })),

    // =================== File tools (file-read) ===================
    mockTool('read_file', 'file-read', objSchema({
      path: { type: 'string', description: 'Project-relative path to the file.' },
      maxChars: { type: 'number', description: 'Maximum characters to return.' },
      includeLineNumbers: { type: 'boolean', description: 'Prefix each line with its line number.' },
      mode: { type: 'string', enum: ['full', 'head', 'tail'], description: 'Read mode.' },
    }, ['path'])),
    mockTool('read_file_range', 'file-read', objSchema({
      path: { type: 'string', description: 'Project-relative path to the file.' },
      startLine: { type: 'number', description: 'First line to read (1-based).' },
      endLine: { type: 'number', description: 'Last line to read (1-based).' },
      contextBefore: { type: 'number', description: 'Extra lines before.' },
      contextAfter: { type: 'number', description: 'Extra lines after.' },
      includeLineNumbers: { type: 'boolean', description: 'Prefix line numbers.' },
    }, ['path'])),
    mockTool('read_many_files', 'file-read', objSchema({
      paths: { type: 'array', items: { type: 'string' }, description: 'File paths.' },
      maxCharsPerFile: { type: 'number', description: 'Max chars per file.' },
      includeLineNumbers: { type: 'boolean', description: 'Prefix line numbers.' },
    }, ['paths'])),
    mockTool('get_file_info', 'file-read', objSchema({
      path: { type: 'string', description: 'Project-relative path.' },
    }, ['path'])),
    mockTool('get_directory_tree', 'file-read', objSchema({
      path: { type: 'string', description: 'Project-relative directory path.' },
      depth: { type: 'number', description: 'Tree depth.' },
      includeHidden: { type: 'boolean', description: 'Include dotfiles.' },
      maxNodes: { type: 'number', description: 'Maximum nodes.' },
    }, ['path'])),

    // =================== File tools (file-nav) ===================
    mockTool('list_files', 'file-nav', objSchema({
      path: { type: 'string', description: 'Project-relative directory path.' },
      depth: { type: 'number', description: 'Directory recursion depth.' },
      includeHidden: { type: 'boolean', description: 'Include dotfiles.' },
      extensions: { type: 'array', items: { type: 'string' }, description: 'Extensions filter.' },
      filesOnly: { type: 'boolean', description: 'Only files.' },
      dirsOnly: { type: 'boolean', description: 'Only directories.' },
      limit: { type: 'number', description: 'Page size.' },
      cursor: { type: 'number', description: 'Pagination cursor.' },
      sort: { type: 'string', enum: ['name', 'mtime', 'size'], description: 'Sort order.' },
    }, ['path'])),
    mockTool('glob_files', 'file-nav', objSchema({
      pattern: { type: 'string', description: 'Glob pattern.' },
      basePath: { type: 'string', description: 'Base path.' },
      includeHidden: { type: 'boolean', description: 'Include dotfiles.' },
      limit: { type: 'number', description: 'Max matches.' },
    }, ['pattern'])),

    // =================== File tools (file-search) ===================
    mockTool('grep_files', 'file-search', objSchema({
      query: { type: 'string', description: 'Text or regex to search for.' },
      isRegex: { type: 'boolean', description: 'Interpret as regex.' },
      basePath: { type: 'string', description: 'Base path.' },
      extensions: { type: 'array', items: { type: 'string' }, description: 'Extension filter.' },
      caseSensitive: { type: 'boolean', description: 'Case-sensitive.' },
      contextLines: { type: 'number', description: 'Context lines.' },
      limit: { type: 'number', description: 'Max hits.' },
      maxFileBytes: { type: 'number', description: 'Skip large files.' },
      includeHidden: { type: 'boolean', description: 'Include dotfiles.' },
    }, ['query'])),

    // =================== File tools (file-write) ===================
    mockTool('write_file', 'file-write', objSchema({
      path: { type: 'string', description: 'Project-relative file path.' },
      content: { type: 'string', description: 'Full file content.' },
      createIfMissing: { type: 'boolean', description: 'Allow creating if missing.' },
      expectedChecksum: { type: 'string', description: 'Required for overwriting.' },
      dryRun: { type: 'boolean', description: 'Preview without writing.' },
    }, ['path', 'content']), 'cautious'),
    mockTool('apply_file_patch', 'file-write', objSchema({
      path: { type: 'string', description: 'Project-relative file path.' },
      expectedChecksum: { type: 'string', description: 'Checksum from latest read.' },
      dryRun: { type: 'boolean', description: 'Preview without writing.' },
      operations: {
        type: 'array',
        description: 'Sequential patch operations.',
        items: {
          type: 'object',
          properties: {
            find: { type: 'string', description: 'Exact text to find.' },
            replace: { type: 'string', description: 'Replacement text.' },
            replaceAll: { type: 'boolean', description: 'Replace all occurrences.' },
            expectedMatches: { type: 'number', description: 'Expected match count.' },
            insertBefore: { type: 'boolean', description: 'Insert before found text.' },
            insertAfter: { type: 'boolean', description: 'Insert after found text.' },
            startLine: { type: 'number', description: 'Start line (1-based).' },
            endLine: { type: 'number', description: 'End line (1-based).' },
          },
        },
      },
    }, ['path', 'expectedChecksum', 'operations']), 'cautious'),
    mockTool('move_path', 'file-write', objSchema({
      from: { type: 'string', description: 'Source path.' },
      to: { type: 'string', description: 'Destination path.' },
      expectedChecksum: { type: 'string', description: 'Checksum guard.' },
    }, ['from', 'to']), 'cautious'),

    // =================== Codebase tools ===================
    mockTool('search_code', 'codebase', objSchema({
      query: { type: 'string', description: 'Search query.' },
      limit: { type: 'number', description: 'Max results.' },
    }, ['query'])),
    mockTool('find_symbol', 'codebase', objSchema({
      query: { type: 'string', description: 'Symbol name or partial symbol name to find.' },
      types: { type: 'array', items: { type: 'string' }, description: 'Chunk types to filter.' },
      limit: { type: 'number', description: 'Max symbol matches.' },
    }, ['query'])),
    mockTool('find_related_files', 'codebase', objSchema({
      path: { type: 'string', description: 'Project-relative path.' },
      symbol: { type: 'string', description: 'Symbol name.' },
      query: { type: 'string', description: 'Fallback keyword.' },
      limit: { type: 'number', description: 'Max related files.' },
    })),
    mockTool('find_references', 'codebase', objSchema({
      symbol: { type: 'string', description: 'Symbol name to find references for.' },
      path: { type: 'string', description: 'Project-relative path to narrow search.' },
      limit: { type: 'number', description: 'Max references.' },
    }, ['symbol'])),
    mockTool('find_importers', 'codebase', objSchema({
      path: { type: 'string', description: 'File path to find importers for.' },
      symbol: { type: 'string', description: 'Symbol name to find importers for.' },
      limit: { type: 'number', description: 'Max importers.' },
    })),
    mockTool('find_exports', 'codebase', objSchema({
      path: { type: 'string', description: 'Project-relative path of the file.' },
    }, ['path'])),
    mockTool('find_test_companions', 'codebase', objSchema({
      path: { type: 'string', description: 'Project-relative path.' },
      symbol: { type: 'string', description: 'Symbol name.' },
      limit: { type: 'number', description: 'Max companions.' },
    })),
    mockTool('find_style_companions', 'codebase', objSchema({
      path: { type: 'string', description: 'Project-relative path.' },
      limit: { type: 'number', description: 'Max companions.' },
    }, ['path'])),

    // =================== Web-project tools ===================
    mockTool('discover_routes', 'web-project', objSchema({})),
    mockTool('inspect_design_system', 'web-project', objSchema({})),
    mockTool('env_doctor', 'web-project', objSchema({})),
    mockTool('component_usage', 'web-project', objSchema({
      name: { type: 'string', description: 'Component name.' },
      path: { type: 'string', description: 'Project-relative file path.' },
    })),
    mockTool('launch_guard_summary', 'web-project', objSchema({
      branch: { type: 'string', description: 'Current git branch name.' },
      isClean: { type: 'boolean', description: 'Whether the working tree is clean.' },
    })),
    mockTool('discover_previews', 'web-project', objSchema({
      branch: { type: 'string', description: 'Current git branch name.' },
      isClean: { type: 'boolean', description: 'Whether the working tree is clean.' },
    })),
  ]
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Agent Tool Evals', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
    registry.registerAll(createAllMockTools())
  })

  // =========================================================================
  // 10 Representative Eval Tasks
  // =========================================================================

  describe('Eval 1: find a component definition', () => {
    it('find_symbol tool exists in the registry', () => {
      expect(registry.has('find_symbol')).toBe(true)
    })

    it('find_symbol has correct category', () => {
      const tool = registry.get('find_symbol')!
      expect(tool.category).toBe('codebase')
    })

    it('find_symbol requires "query" argument', () => {
      const tool = registry.get('find_symbol')!
      expect(tool.schema.required).toContain('query')
      expect(tool.schema.properties).toHaveProperty('query')
      expect(tool.schema.properties.query.type).toBe('string')
    })

    it('find_symbol has optional types and limit args', () => {
      const tool = registry.get('find_symbol')!
      expect(tool.schema.properties).toHaveProperty('types')
      expect(tool.schema.properties.types.type).toBe('array')
      expect(tool.schema.properties).toHaveProperty('limit')
      expect(tool.schema.properties.limit.type).toBe('number')
    })
  })

  describe('Eval 2: find all usages/importers of a hook', () => {
    it('find_references tool exists with correct schema', () => {
      const tool = registry.get('find_references')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('codebase')
      expect(tool.schema.required).toContain('symbol')
      expect(tool.schema.properties).toHaveProperty('symbol')
      expect(tool.schema.properties).toHaveProperty('path')
      expect(tool.schema.properties).toHaveProperty('limit')
    })

    it('find_importers tool exists with correct schema', () => {
      const tool = registry.get('find_importers')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('codebase')
      expect(tool.schema.properties).toHaveProperty('symbol')
      expect(tool.schema.properties).toHaveProperty('path')
      expect(tool.schema.properties).toHaveProperty('limit')
    })
  })

  describe('Eval 3: locate test/story/style companions', () => {
    it('find_test_companions exists with correct schema', () => {
      const tool = registry.get('find_test_companions')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('codebase')
      expect(tool.schema.properties).toHaveProperty('path')
      expect(tool.schema.properties).toHaveProperty('symbol')
      expect(tool.schema.properties).toHaveProperty('limit')
    })

    it('find_style_companions exists with correct schema', () => {
      const tool = registry.get('find_style_companions')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('codebase')
      expect(tool.schema.required).toContain('path')
      expect(tool.schema.properties).toHaveProperty('path')
      expect(tool.schema.properties).toHaveProperty('limit')
    })
  })

  describe('Eval 4: scope a refactor to changed files only', () => {
    it('list_changed_files exists with correct schema and category', () => {
      const tool = registry.get('list_changed_files')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('git')
      expect(tool.schema.properties).toHaveProperty('scope')
      expect(tool.schema.properties.scope.enum).toEqual(['working_tree', 'staged', 'branch_diff'])
      expect(tool.schema.properties).toHaveProperty('limit')
    })

    it('git_diff exists in the registry', () => {
      const tool = registry.get('git_diff')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('git')
    })
  })

  describe('Eval 5: discover all app routes', () => {
    it('discover_routes exists with correct category', () => {
      const tool = registry.get('discover_routes')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('web-project')
    })

    it('discover_routes has no required args', () => {
      const tool = registry.get('discover_routes')!
      expect(tool.schema.required).toBeUndefined()
      expect(Object.keys(tool.schema.properties)).toHaveLength(0)
    })
  })

  describe('Eval 6: explain the design-token source of a color', () => {
    it('inspect_design_system exists with correct category', () => {
      const tool = registry.get('inspect_design_system')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('web-project')
    })
  })

  describe('Eval 7: diagnose a missing env var', () => {
    it('env_doctor exists with correct category', () => {
      const tool = registry.get('env_doctor')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('web-project')
    })
  })

  describe('Eval 8: summarize launch readiness', () => {
    it('launch_guard_summary exists with correct category', () => {
      const tool = registry.get('launch_guard_summary')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('web-project')
    })

    it('launch_guard_summary has optional branch and isClean schema', () => {
      const tool = registry.get('launch_guard_summary')!
      expect(tool.schema.properties).toHaveProperty('branch')
      expect(tool.schema.properties.branch.type).toBe('string')
      expect(tool.schema.properties).toHaveProperty('isClean')
      expect(tool.schema.properties.isClean.type).toBe('boolean')
      // Both are optional (no required array or empty required)
      expect(tool.schema.required).toBeUndefined()
    })
  })

  describe('Eval 9: infer preview URL/provider', () => {
    it('discover_previews exists with correct category', () => {
      const tool = registry.get('discover_previews')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('web-project')
    })
  })

  describe('Eval 10: perform a multi-file guarded refactor', () => {
    it('write_file exists with file-write category and cautious safety', () => {
      const tool = registry.get('write_file')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('file-write')
      expect(tool.safetyLevel).toBe('cautious')
    })

    it('write_file schema includes dryRun and expectedChecksum', () => {
      const tool = registry.get('write_file')!
      expect(tool.schema.properties).toHaveProperty('dryRun')
      expect(tool.schema.properties.dryRun.type).toBe('boolean')
      expect(tool.schema.properties).toHaveProperty('expectedChecksum')
      expect(tool.schema.properties.expectedChecksum.type).toBe('string')
    })

    it('apply_file_patch exists with file-write category and cautious safety', () => {
      const tool = registry.get('apply_file_patch')!
      expect(tool).toBeDefined()
      expect(tool.category).toBe('file-write')
      expect(tool.safetyLevel).toBe('cautious')
    })

    it('apply_file_patch schema includes dryRun, expectedChecksum, and operations', () => {
      const tool = registry.get('apply_file_patch')!
      expect(tool.schema.properties).toHaveProperty('dryRun')
      expect(tool.schema.properties).toHaveProperty('expectedChecksum')
      expect(tool.schema.properties).toHaveProperty('operations')
      expect(tool.schema.required).toContain('expectedChecksum')
      expect(tool.schema.required).toContain('operations')
    })
  })

  // =========================================================================
  // Registry Completeness
  // =========================================================================

  describe('Registry completeness', () => {
    it('all registered tools have required fields: name, description, schema, category, safetyLevel, execute', () => {
      const names = registry.names()
      expect(names.length).toBeGreaterThan(0)

      for (const name of names) {
        const tool = registry.get(name)!
        expect(tool.name, `${name} must have name`).toBe(name)
        expect(tool.description, `${name} must have description`).toBeTruthy()
        expect(tool.schema, `${name} must have schema`).toBeDefined()
        expect(tool.schema.type, `${name} schema type must be object`).toBe('object')
        expect(tool.schema.properties, `${name} must have properties`).toBeDefined()
        expect(tool.category, `${name} must have category`).toBeTruthy()
        expect(tool.safetyLevel, `${name} must have safetyLevel`).toBeTruthy()
        expect(typeof tool.execute, `${name} must have execute function`).toBe('function')
      }
    })

    it('all tool names are unique (no duplicates)', () => {
      const names = registry.names()
      const unique = new Set(names)
      expect(names.length).toBe(unique.size)
    })

    it('toProviderSchemas() returns valid OpenAI-compatible format for each tool', () => {
      const schemas: ProviderToolSchema[] = registry.toProviderSchemas()
      expect(schemas.length).toBe(registry.size)

      for (const schema of schemas) {
        expect(schema.type).toBe('function')
        expect(schema.function).toBeDefined()
        expect(schema.function.name).toBeTruthy()
        expect(schema.function.description).toBeTruthy()
        expect(schema.function.parameters).toBeDefined()
        expect(schema.function.parameters.type).toBe('object')
        expect(schema.function.parameters.properties).toBeDefined()
      }
    })

    it('toProviderSchemas() names match registry names 1:1', () => {
      const schemas = registry.toProviderSchemas()
      const schemaNames = schemas.map((s) => s.function.name).sort()
      const registryNames = registry.names().sort()
      expect(schemaNames).toEqual(registryNames)
    })
  })

  // =========================================================================
  // Category Coverage
  // =========================================================================

  describe('Category coverage', () => {
    const requiredCategories: ToolCategory[] = [
      'codebase',
      'web-project',
      'file-read',
      'file-write',
      'git',
      'task',
      'note',
    ]

    it.each(requiredCategories)('has at least 1 tool in category: %s', (category) => {
      const tools = registry.byCategory(category)
      expect(tools.length, `category "${category}" should have at least 1 tool`).toBeGreaterThanOrEqual(1)
    })

    describe('semantic codebase tools are all present and categorized', () => {
      const semanticTools = [
        'find_symbol',
        'find_references',
        'find_importers',
        'find_exports',
        'find_test_companions',
        'find_style_companions',
      ]

      it.each(semanticTools)('%s exists and has category "codebase"', (toolName) => {
        const tool = registry.get(toolName)
        expect(tool, `${toolName} should be registered`).toBeDefined()
        expect(tool!.category).toBe('codebase')
      })
    })

    describe('web-project bridge tools are all present and categorized', () => {
      const bridgeTools = [
        'discover_routes',
        'inspect_design_system',
        'env_doctor',
        'component_usage',
        'launch_guard_summary',
        'discover_previews',
      ]

      it.each(bridgeTools)('%s exists and has category "web-project"', (toolName) => {
        const tool = registry.get(toolName)
        expect(tool, `${toolName} should be registered`).toBeDefined()
        expect(tool!.category).toBe('web-project')
      })
    })
  })

  // =========================================================================
  // Tool Routing Preferences Validation
  // =========================================================================

  describe('Tool routing preferences', () => {
    it('grep_files exists AND find_symbol exists (semantic preferred)', () => {
      expect(registry.has('grep_files')).toBe(true)
      expect(registry.has('find_symbol')).toBe(true)

      // Semantic tool should be in codebase category
      expect(registry.get('find_symbol')!.category).toBe('codebase')
      // Brute-force tool should be in file-search category
      expect(registry.get('grep_files')!.category).toBe('file-search')
    })

    it('list_files exists AND find_related_files exists (semantic preferred)', () => {
      expect(registry.has('list_files')).toBe(true)
      expect(registry.has('find_related_files')).toBe(true)

      // Semantic tool should be in codebase category
      expect(registry.get('find_related_files')!.category).toBe('codebase')
      // Brute-force tool should be in file-nav category
      expect(registry.get('list_files')!.category).toBe('file-nav')
    })
  })

  // =========================================================================
  // Registry Execution Contract
  // =========================================================================

  describe('Registry execution contract', () => {
    const mockCtx: ToolExecutionContext = {
      projectId: 'test-project',
      projectPath: '/tmp/test-project',
    }

    it('execute returns JSON string for known tools', async () => {
      const result = await registry.execute('find_symbol', mockCtx, { query: 'Button' })
      const parsed = JSON.parse(result)
      expect(parsed).toEqual({ mock: true })
    })

    it('execute returns error JSON for unknown tools', async () => {
      const result = await registry.execute('nonexistent_tool', mockCtx, {})
      const parsed = JSON.parse(result)
      expect(parsed).toHaveProperty('error')
      expect(parsed.error).toContain('Unknown tool')
    })

    it('registry.size matches the number of registered tools', () => {
      const allMocks = createAllMockTools()
      expect(registry.size).toBe(allMocks.length)
    })

    it('byCategory returns only tools of the specified category', () => {
      const gitTools = registry.byCategory('git')
      for (const tool of gitTools) {
        expect(tool.category).toBe('git')
      }
      expect(gitTools.length).toBe(4) // git_status, git_log, git_diff, list_changed_files
    })

    it('registering a duplicate name overwrites the previous definition', () => {
      const original = registry.get('find_symbol')!
      const replacement = mockTool('find_symbol', 'codebase', objSchema({
        query: { type: 'string', description: 'Replaced.' },
      }, ['query']))
      replacement.description = 'Replaced find_symbol'

      registry.register(replacement)

      const updated = registry.get('find_symbol')!
      expect(updated.description).toBe('Replaced find_symbol')
      expect(updated.description).not.toBe(original.description)
    })
  })
})
