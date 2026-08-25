# Security

This document records known security considerations for the project so contributors and users can make informed decisions.

---

## Threat Model

This is a **local-first desktop application**. The backend server binds to `127.0.0.1` by default and is not intended to be exposed to a network. Authentication via `AGENT_API_KEY` is opt-in.

---

## Known Risks

### 1. `execute_code` — Node.js `vm` Sandbox Escape

**Location:** `backend/src/tools/builtin.ts`

The `execute_code` tool uses Node's built-in `vm` module to run untrusted code. The sandbox masks `process`, `require`, `Buffer`, and `globalThis`, but **the `vm` module is not a security boundary**. A determined attacker can escape via prototype chain traversal (e.g. `this.constructor.constructor('return process')()`).

**Status: DISABLED.** The tool is registered with `enabled: false` (implementation kept for rollback) and is filtered out of `getSchemas()` and `GET /api/agent/tools`, so neither the LLM nor the client can invoke it. The only code-execution tool is `run_code` (`backend/src/tools/agent-meta-tools.ts`), which runs inside the `isolated-vm` sandbox (separate V8 isolate, 128 MB memory cap, 30 s timeout).

---

### 2. `terminal/execute` — Shell Command Injection

**Location:** `backend/src/routes/terminal.ts`

The `/api/terminal/execute` endpoint previously accepted arbitrary command strings through `zsh -c`, allowing shell metacharacter injection (`; rm -rf /`, `$()`, etc.).

**Mitigations in place (v2):**
- `assertSafeCommand()` rejects shell metacharacters (`; | & < > \` $( && ||`)
- Rejects shell wrapper commands (`sh`, `bash`, `zsh`, `cmd`, `powershell`)
- API key authentication required when `AGENT_API_KEY` is set

**Mitigations in place (v3):** `assertSafeCommand` is now enforced **inside the shared
executor** (`backend/src/computer-use/handlers.ts` → `executeCommand`). Every execution
path — the terminal route, the `run_command` agent tool, and the `terminal.execute`
computer-use tool — validates the command before it reaches the shell, so the check
cannot be bypassed by going through a different entry point.

**Remaining concern:** The approval gate can be globally disabled via `/api/agent/settings/approval`. If auth is not enabled, any local caller can execute arbitrary shell commands.

---

### 3. Tool Error Messages Leaking Internal Paths

**Location:** `backend/src/tools/registry.ts`

Tool error responses previously included raw `err.message`, which may contain absolute file paths or stack traces.

**Mitigation (v2):** Error messages are now sanitized — absolute paths are replaced with `[path]` and the message is wrapped in a generic prefix.

---

### 4. Calculator `Function()` Code Injection

**Location:** `backend/src/tools/builtin.ts`

The `calculator` tool previously used `new Function(...)` to evaluate arithmetic expressions, which allowed injection via crafted expressions (e.g. `1); require('child_process').exec('rm -rf /'); (`).

**Mitigation (v2):** Replaced with a recursive-descent parser (`safeEvalExpr`) that only evaluates numeric literals and binary operations. No `eval` or `Function` constructor is used.

---

### 5. Workspace Path Traversal

**Location:** `backend/src/workspace/fs.ts`

The workspace filesystem layer validates all paths against the workspace root using `path.resolve()` + `startsWith(root + '/')`. This correctly rejects sibling directory access (e.g. `/projectX` would not pass a naive `startsWith('/project')` check).

**Mitigation:** Path traversal is blocked for all read and write operations. The `root` query parameter is also validated to be within the base root.

**Mitigation (v2, symlink escape):** All file operations (`read`/`write`/`delete`/`list`)
now resolve the **real path** (`realpathSync`, following symlinks) before the
within-root check. A symlink inside the workspace that points outside (e.g. `link →
/etc`) is rejected with `WorkspaceAccessError`/`EACCES_ROOT`; symlinks that stay inside
the workspace keep working.

---

### 6. MCP Server URL Validation

**Location:** `backend/src/mcp/manager.ts`

MCP server configuration allows specifying arbitrary URLs for SSE/HTTP transports. A malicious MCP config could point to internal services.

**Mitigation:** MCP configs are stored locally and require auth (when `AGENT_API_KEY` is set) to add new servers. The knowledge ingest route has explicit SSRF protection (DNS rebinding check, private IP rejection) — consider applying similar logic to MCP URLs.

---

## Recommendations for Deployments

| Risk | Recommendation |
|------|---------------|
| `execute_code` sandbox | Use `isolated-vm` or Docker sandbox for production |
| Terminal command execution | Keep `AGENT_API_KEY` enabled; enforce approval gates |
| API key storage | Never commit `.env`; use secret management in CI/CD |
| Rate limiting | 200 req/15min per IP is the default; tighten for public deployments |
| Database at rest | SQLite is unencrypted; enable SQLCipher if sensitive data is stored |

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately to the maintainers. Do not open a public issue.
