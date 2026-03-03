import { describe, it, expect } from 'vitest'
import {
  chunkFile,
  chunkMarkdown,
  chunkGitHistory,
  detectLanguage,
} from '../../main/services/CodeChunker'

// ─── Language Detection ──────────────────────────────────────────────────────

describe('detectLanguage', () => {
  it('detects TypeScript files', () => {
    expect(detectLanguage('src/app.ts')).toBe('typescript')
    expect(detectLanguage('component.tsx')).toBe('typescript')
  })

  it('detects JavaScript files', () => {
    expect(detectLanguage('index.js')).toBe('javascript')
    expect(detectLanguage('App.jsx')).toBe('javascript')
  })

  it('detects Swift files', () => {
    expect(detectLanguage('ViewController.swift')).toBe('swift')
  })

  it('detects Python files', () => {
    expect(detectLanguage('main.py')).toBe('python')
  })

  it('detects Rust files', () => {
    expect(detectLanguage('lib.rs')).toBe('rust')
  })

  it('detects Go files', () => {
    expect(detectLanguage('main.go')).toBe('go')
  })

  it('detects Java files', () => {
    expect(detectLanguage('App.java')).toBe('java')
  })

  it('detects Markdown files', () => {
    expect(detectLanguage('README.md')).toBe('markdown')
  })

  it('detects C# files', () => {
    expect(detectLanguage('Program.cs')).toBe('csharp')
  })

  it('detects C/C++ files', () => {
    expect(detectLanguage('main.cpp')).toBe('cpp')
    expect(detectLanguage('util.c')).toBe('cpp')
    expect(detectLanguage('header.h')).toBe('cpp')
  })

  it('detects Ruby files', () => {
    expect(detectLanguage('app.rb')).toBe('ruby')
  })

  it('detects PHP files', () => {
    expect(detectLanguage('index.php')).toBe('php')
  })

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('data.csv')).toBeNull()
    expect(detectLanguage('Makefile')).toBeNull()
  })

  it('handles case-insensitive extensions', () => {
    expect(detectLanguage('file.TS')).toBe('typescript')
    expect(detectLanguage('file.PY')).toBe('python')
  })

  it('handles paths with directories', () => {
    expect(detectLanguage('src/components/Button.tsx')).toBe('typescript')
    expect(detectLanguage('/Users/dev/project/main.go')).toBe('go')
  })
})

// ─── TypeScript Chunking ─────────────────────────────────────────────────────

describe('chunkFile - TypeScript', () => {
  it('extracts function declarations', () => {
    const content = `export function greet(name: string): string {
  return \`Hello, \${name}\`
}

export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url)
  return response.json()
}
`
    const chunks = chunkFile(content, 'typescript')

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')
    expect(funcChunks.length).toBe(2)
    expect(funcChunks[0].symbolName).toBe('greet')
    expect(funcChunks[1].symbolName).toBe('fetchData')
  })

  it('extracts arrow function declarations', () => {
    const content = `export const add = (a: number, b: number) => {
  return a + b
}

export const multiply = async (a: number, b: number) => {
  return a * b
}
`
    const chunks = chunkFile(content, 'typescript')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    expect(funcChunks.length).toBe(2)
    expect(funcChunks[0].symbolName).toBe('add')
    expect(funcChunks[1].symbolName).toBe('multiply')
  })

  it('extracts classes with nested method names', () => {
    const content = `export class Calculator {
  private value: number = 0

  function add(n: number): Calculator {
    this.value += n
    return this
  }

  function subtract(n: number): Calculator {
    this.value -= n
    return this
  }
}
`
    const chunks = chunkFile(content, 'typescript')
    const classChunks = chunks.filter((c) => c.chunkType === 'class')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    expect(classChunks.length).toBe(1)
    expect(classChunks[0].symbolName).toBe('Calculator')

    // Methods should be prefixed with class name
    expect(funcChunks.length).toBe(2)
    expect(funcChunks[0].symbolName).toBe('Calculator.add')
    expect(funcChunks[1].symbolName).toBe('Calculator.subtract')
  })

  it('extracts interfaces and type aliases', () => {
    const content = `export interface User {
  id: string
  name: string
  email: string
}

export type Status = 'active' | 'inactive' | 'pending'
`
    const chunks = chunkFile(content, 'typescript')
    const classChunks = chunks.filter((c) => c.chunkType === 'class')

    expect(classChunks.length).toBeGreaterThanOrEqual(1)
    expect(classChunks[0].symbolName).toBe('User')
  })
})

// ─── Python Chunking ─────────────────────────────────────────────────────────

describe('chunkFile - Python', () => {
  it('extracts function definitions', () => {
    const content = `def greet(name):
    return f"Hello, {name}"

async def fetch_data(url):
    response = await aiohttp.get(url)
    return await response.json()
`
    const chunks = chunkFile(content, 'python')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    expect(funcChunks.length).toBe(2)
    expect(funcChunks[0].symbolName).toBe('greet')
    expect(funcChunks[1].symbolName).toBe('fetch_data')
  })

  it('extracts class definitions', () => {
    const content = `class Calculator:
    """A simple calculator class with basic operations."""
    default_value = 0
    max_value = 1000

    def __init__(self):
        self.value = 0

    def add(self, n):
        self.value += n
        return self

    def subtract(self, n):
        self.value -= n
        return self
`
    const chunks = chunkFile(content, 'python')

    const classChunks = chunks.filter((c) => c.chunkType === 'class')
    expect(classChunks.length).toBe(1)
    expect(classChunks[0].symbolName).toBe('Calculator')

    const funcChunks = chunks.filter((c) => c.chunkType === 'function')
    expect(funcChunks.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── Swift Chunking ──────────────────────────────────────────────────────────

describe('chunkFile - Swift', () => {
  it('extracts function declarations', () => {
    const content = `public func greet(name: String) -> String {
    return "Hello, \\(name)"
}

private static func helper() {
    print("helping")
}

func doSomething() {
    // implementation
    let x = 1
    let y = 2
}
`
    const chunks = chunkFile(content, 'swift')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    expect(funcChunks.length).toBeGreaterThanOrEqual(2)
    expect(funcChunks[0].symbolName).toBe('greet')
  })

  it('extracts class and struct declarations', () => {
    const content = `public class ViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
    }
}

struct Point {
    var x: Double
    var y: Double
}
`
    const chunks = chunkFile(content, 'swift')
    const classChunks = chunks.filter((c) => c.chunkType === 'class')

    expect(classChunks.length).toBeGreaterThanOrEqual(1)
    expect(classChunks[0].symbolName).toBe('ViewController')
  })

  it('handles init and deinit', () => {
    const content = `class Foo {
    init(value: Int) {
        self.value = value
    }

    deinit {
        cleanup()
    }
}
`
    const chunks = chunkFile(content, 'swift')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    // Should find init and/or deinit
    const symbolNames = funcChunks.map((c) => c.symbolName)
    expect(
      symbolNames.some((s) => s?.includes('init') ?? false)
    ).toBe(true)
  })
})

// ─── Rust Chunking ───────────────────────────────────────────────────────────

describe('chunkFile - Rust', () => {
  it('extracts function declarations', () => {
    const content = `pub fn greet(name: &str) -> String {
    format!("Hello, {}", name)
}

async fn fetch_data(url: &str) -> Result<String, Error> {
    let response = reqwest::get(url).await?;
    Ok(response.text().await?)
}
`
    const chunks = chunkFile(content, 'rust')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    expect(funcChunks.length).toBe(2)
    expect(funcChunks[0].symbolName).toBe('greet')
    expect(funcChunks[1].symbolName).toBe('fetch_data')
  })

  it('extracts struct and impl blocks', () => {
    const content = `pub struct Point {
    x: f64,
    y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}
`
    const chunks = chunkFile(content, 'rust')
    const classChunks = chunks.filter((c) => c.chunkType === 'class')

    expect(classChunks.length).toBeGreaterThanOrEqual(1)
    expect(classChunks[0].symbolName).toBe('Point')
  })
})

// ─── Go Chunking ─────────────────────────────────────────────────────────────

describe('chunkFile - Go', () => {
  it('extracts function declarations', () => {
    const content = `func main() {
	fmt.Println("Hello")
}

func add(a, b int) int {
	return a + b
}
`
    const chunks = chunkFile(content, 'go')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    expect(funcChunks.length).toBe(2)
    expect(funcChunks[0].symbolName).toBe('main')
    expect(funcChunks[1].symbolName).toBe('add')
  })

  it('extracts type declarations', () => {
    const content = `type Server struct {
	port int
	host string
}

type Handler interface {
	ServeHTTP(w ResponseWriter, r *Request)
}
`
    const chunks = chunkFile(content, 'go')
    const classChunks = chunks.filter((c) => c.chunkType === 'class')

    expect(classChunks.length).toBe(2)
    expect(classChunks[0].symbolName).toBe('Server')
    expect(classChunks[1].symbolName).toBe('Handler')
  })
})

// ─── Markdown Chunking ──────────────────────────────────────────────────────

describe('chunkMarkdown', () => {
  it('splits on headings', () => {
    const content = `# Introduction

This is the intro section with some content.

## Getting Started

Follow these steps to get started with the project.

## API Reference

Here is the API reference documentation.
`
    const chunks = chunkMarkdown(content)

    expect(chunks.length).toBe(3)
    expect(chunks[0].chunkType).toBe('doc')
    expect(chunks[0].symbolName).toBe('Introduction')
    expect(chunks[1].symbolName).toBe('Getting Started')
    expect(chunks[2].symbolName).toBe('API Reference')
  })

  it('handles content before first heading', () => {
    const content = `Some preamble text that is long enough to pass the minimum character threshold.

# Main Section

This is the main section content here.
`
    const chunks = chunkMarkdown(content)

    // First chunk should have no heading name (content before first heading)
    expect(chunks.length).toBe(2)
    expect(chunks[0].symbolName).toBeNull()
    expect(chunks[1].symbolName).toBe('Main Section')
  })

  it('returns empty array for empty content', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   ')).toEqual([])
  })
})

// ─── Fallback Chunking ──────────────────────────────────────────────────────

describe('chunkFile - Fallback', () => {
  it('uses fixed-size chunking for unknown languages', () => {
    // Generate 120 lines of content
    const lines = Array.from(
      { length: 120 },
      (_, i) => `line ${i + 1}: some content here`
    )
    const content = lines.join('\n')

    const chunks = chunkFile(content, 'unknown_language')

    // Should produce multiple chunks
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].chunkType).toBe('block')
    expect(chunks[0].symbolName).toBeNull()
    expect(chunks[0].startLine).toBe(1)
  })

  it('uses fallback for null language', () => {
    const lines = Array.from(
      { length: 60 },
      (_, i) => `line ${i + 1}: some content here`
    )
    const content = lines.join('\n')

    const chunks = chunkFile(content, null)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].chunkType).toBe('block')
  })
})

// ─── Header Extraction ──────────────────────────────────────────────────────

describe('chunkFile - Header extraction', () => {
  it('extracts header chunk from lines before first boundary', () => {
    const content = `// Copyright 2024 Example Corp.
// Licensed under MIT

import { something } from 'somewhere'
import { other } from 'other'

export function main() {
  console.log('hello')
}
`
    const chunks = chunkFile(content, 'typescript')
    const headers = chunks.filter((c) => c.chunkType === 'header')

    expect(headers.length).toBe(1)
    expect(headers[0].content).toContain('Copyright')
    expect(headers[0].content).toContain('import')
    expect(headers[0].startLine).toBe(1)
  })

  it('does not emit header when first line is a boundary', () => {
    const content = `export function main() {
  console.log('hello')
}
`
    const chunks = chunkFile(content, 'typescript')
    const headers = chunks.filter((c) => c.chunkType === 'header')

    expect(headers.length).toBe(0)
  })
})

// ─── Large Chunk Splitting ───────────────────────────────────────────────────

describe('chunkFile - Large chunk splitting', () => {
  it('splits chunks exceeding 100 lines at blank lines', () => {
    // Create a function with 150 lines and a blank line after line 110
    const lines: string[] = [
      'export function bigFunction() {',
    ]
    for (let i = 1; i <= 150; i++) {
      if (i === 110) {
        lines.push('') // blank line for split point
      } else {
        lines.push(`  const line${i} = ${i}`)
      }
    }
    lines.push('}')
    const content = lines.join('\n')

    const chunks = chunkFile(content, 'typescript')

    // Should have been split into at least 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── Git History Chunking ────────────────────────────────────────────────────

describe('chunkGitHistory', () => {
  it('parses git log --oneline output into commit chunks', () => {
    const content = `abc1234 feat: add user authentication
def5678 fix: resolve login redirect issue
1234abc refactor: extract database helpers
`
    const chunks = chunkGitHistory(content)

    expect(chunks.length).toBe(3)
    expect(chunks[0].chunkType).toBe('commit')
    expect(chunks[0].symbolName).toBe('abc1234')
    expect(chunks[0].content).toContain('feat: add user authentication')
    expect(chunks[0].startLine).toBeNull()
    expect(chunks[0].endLine).toBeNull()
  })

  it('handles multi-line commit messages', () => {
    const content = `abc1234 feat: add user authentication
  This is a longer description of the commit.
def5678 fix: resolve login redirect issue
`
    const chunks = chunkGitHistory(content)

    expect(chunks.length).toBe(2)
    expect(chunks[0].content).toContain('longer description')
  })

  it('returns empty for empty input', () => {
    expect(chunkGitHistory('')).toEqual([])
    expect(chunkGitHistory('   ')).toEqual([])
  })
})

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('chunkFile - Edge cases', () => {
  it('returns empty array for empty content', () => {
    expect(chunkFile('', 'typescript')).toEqual([])
    expect(chunkFile('   ', 'typescript')).toEqual([])
  })

  it('returns empty array for null content equivalent', () => {
    expect(chunkFile('', null)).toEqual([])
  })

  it('handles file with only comments (no boundaries)', () => {
    const content = `// This is just a comment file
// with multiple lines
// but no actual code boundaries
// that the chunker would recognize
// so it should fall into a block
// with enough lines to pass the filter
`
    const chunks = chunkFile(content, 'typescript')

    // May be 0 chunks if below thresholds, or 1 block
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(20)
    }
  })

  it('filters out very small chunks', () => {
    const content = `export function a() {
}

export function b() {
  // This function has enough content to be meaningful
  // with multiple lines of implementation
  const x = 1
  const y = 2
  return x + y
}
`
    const chunks = chunkFile(content, 'typescript')

    // Every chunk should meet minimum size requirements
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(20)
    }
  })

  it('sets correct startLine and endLine', () => {
    const content = `export function first() {
  return 1
}

export function second() {
  return 2
}
`
    const chunks = chunkFile(content, 'typescript')
    const funcChunks = chunks.filter((c) => c.chunkType === 'function')

    for (const chunk of funcChunks) {
      expect(chunk.startLine).not.toBeNull()
      expect(chunk.endLine).not.toBeNull()
      expect(chunk.startLine!).toBeLessThanOrEqual(chunk.endLine!)
    }
  })
})

// ─── Java Chunking ───────────────────────────────────────────────────────────

describe('chunkFile - Java', () => {
  it('extracts class and method declarations', () => {
    const content = `public class Calculator {
    private int value = 0;

    public int add(int n) {
        this.value += n;
        return this.value;
    }

    public int getValue() {
        return this.value;
    }
}
`
    const chunks = chunkFile(content, 'java')
    const classChunks = chunks.filter((c) => c.chunkType === 'class')

    expect(classChunks.length).toBeGreaterThanOrEqual(1)
    expect(classChunks[0].symbolName).toBe('Calculator')
  })
})
