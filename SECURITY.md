# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in CodeFire, **please do not open a public issue.** Instead, report it privately so we can address it before disclosure.

### How to Report

**Email**: [security@websitebutlers.com](mailto:security@websitebutlers.com)

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected platform (macOS Swift, Electron Windows/Linux, MCP server)
- Impact assessment (what an attacker could do)
- Any suggested fix, if you have one

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 1 week — we'll confirm whether it's a valid vulnerability and its severity
- **Fix timeline** depends on severity:
  - Critical (remote code execution, data exfiltration): patch within 72 hours
  - High (privilege escalation, auth bypass): patch within 1 week
  - Medium/Low: included in the next scheduled release
- **Credit** in the release notes (unless you prefer to remain anonymous)

## Scope

### In Scope

- **Electron app** — main process, preload, renderer, IPC handlers
- **Swift app** — all app code and services
- **MCP server** — both Node.js and Swift implementations
- **Database** — SQLite schema, migrations, data access
- **Browser automation** — webview security, domain allowlist bypass
- **Deep links** — `codefire://` protocol handler abuse
- **Dependencies** — vulnerabilities in direct dependencies

### Out of Scope

- Vulnerabilities in upstream tools (Claude Code, Gemini CLI, etc.) — report those to their maintainers
- Issues requiring physical access to the machine
- Social engineering attacks
- Denial of service via resource exhaustion on local machine (CodeFire is a local-only app)

## Security Architecture

CodeFire is a **local-first desktop app** with no cloud backend. Key security considerations:

- **Data storage**: All data lives in a local SQLite database. No data is sent to external servers except API calls you explicitly configure (OpenRouter for AI features, Google for Gmail).
- **API keys**: Stored in a local config file (`codefire-settings.json`). Never transmitted except to their respective API endpoints.
- **MCP server**: Communicates via stdio (stdin/stdout) with the parent CLI process. No network listeners. Access is limited to whoever can execute the binary.
- **Browser automation**: Restricted by a configurable domain allowlist in Settings. Commands execute in an Electron webview sandbox.
- **Electron security**: Context isolation enabled, node integration disabled in renderer, preload script exposes a minimal typed API surface.

## Best Practices for Users

- Keep your OpenRouter API key private — don't commit `codefire-settings.json` to version control
- Use the browser domain allowlist to restrict which sites the automation can access
- Keep CodeFire updated to the latest release
- Review MCP server permissions when connecting new CLI tools
