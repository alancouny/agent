# AI Agent App — Architecture

> Last updated: 2026-08-13. This document reflects the **current** codebase after the
> agent-loop, tool registry, tasks, MCP client, skills backend, and memory work landed.
> The previous version described a pre-agent-loop monolith and is now obsolete.

## 1. Overview

AI Agent App is a local-first desktop-style AI assistant. The defining piece is a
**ReAct-style agent loop** (`AgentCore`) that plans with an LLM, calls tools, observes
results, and iterates until it answers. Tools are registered in a single in-process
**tool registry**, which is also the source of truth surfaced to the UI and to connected
MCP servers.

Everything else hangs off that loop:

- **Tasks** — the agent tracks multi-step work via task tools so the user can watch progress.
- **MCP** — external Model Context Protocol servers are connected at runtime and their
  tools are bridged into the same registry (`mcp__<server>__<tool>`).
- **Skills** — short procedure checklists injected into the system prompt when a request matches.
- **Memory** — semantic notes from earlier turns in a session are re-injected as context.
- **Knowledge base (RAG)** — documents are chunked, embedded (OpenAI-compatible
  `/embeddings`), and stored in SQLite; the top-K chunks are retrieved and injected into
  the system prompt on each turn (`retrieveKnowledge()`).
- **Computer-use** — a macOS `osascript` bridge exposing screen/UI automation tools.
- **Multi-model failover & compare** — `callLLM()` walks a provider chain
  (`config.fallbacks`) on error; `POST /api/agent/compare` runs one prompt against many
  models side-by-side.
- **Prompts & Voice** — a reusable prompt library (`/api/prompts`) and TTS/STT endpoints
  (`/api/voice`) round out the feature set without bloating the UI.

## 2. Tech stack

### Frontend
| Tech | Version | Purpose |
|------|---------|---------|
| React | 19.x | UI |
| TypeScript | 5.x | Type safety |
| Vite | 6.x | Build / dev server |
| Tailwind CSS | 4.x | Styling |
| Axios | 1.x | HTTP client (`src/api/client.ts`) |
| lucide-react | latest | Icons |

### Backend
| Tech | Version | Purpose |
|------|---------|---------|
| Node.js | 23.x | Runtime |
| Express | 4.x | HTTP framework |
| TypeScript | 5.x | Type safety |
| better-sqlite3 | 11.x | Local persistence (no external DB) |
| @modelcontextprotocol/sdk | 1.30.x | MCP client + fixtures |
| openai | 4.x | OpenAI-compatible chat (incl. Ollama) |
| @anthropic-ai/sdk | latest | Anthropic Claude chat |
| uuid | 9.x | IDs |
| tsx | latest | Dev runner / tests |

## 3. System diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite) — src/                                        │
│                                                                        │
│  Sidebar ── tabs: chat │ tasks │ computer │ skills │ mcp │ image │     │
│                        video │ models │ tools │ settings               │
│  (Knowledge base + Prompt library live as sections inside Settings)    │
│                                                                        │
│  AgentChat ── SSE ──> agentApi.chat()                                  │
│  TasksPanel / SkillsPanel / McpPanel / ToolsPanel ── REST ──> APIs     │
│  Settings: Knowledge + Prompts sections; Chat: fork + search + tokens  │
└───────────────────────────────────┬────────────────────────────────────┘
                                     │  HTTP / REST + SSE
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Backend (Express) — backend/src/                                      │
│                                                                        │
│  routes/                                                               │
│   agent.ts      (POST /chat SSE, GET /tools, POST /tools/execute,     │
│                  POST /tools/approve, approval settings, conn tests,   │
│                  /search, /fork, /tokens, /compare)                    │
│   session.ts     tasks.ts      mcp.ts       skills.ts                  │
│   knowledge.ts   prompts.ts    voice.ts                                │
│   computer-use.ts  code.ts  image.ts  video.ts  ollama.ts  model_provider.ts  health.ts │
│                                                                        │
│  agent/core.ts  ── AgentCore (ReAct loop, memory+skills+KB injection,  │
│                        multi-model failover, token logging)            │
│        │ uses                                                          │
│  tools/registry.ts  ── ToolRegistry (register/unregister/execute/      │
│                        approval gate + audit log)                       │
│        ▲ builtin.ts │ tasks/agent-tools.ts │ computer-use/register-tools│
│        ▲ mcp/manager.ts (bridges MCP tools in as mcp__*)               │
│        ▲ tools/system-tools.ts (run_command, list_files)              │
│                                                                        │
│  mcp/store.ts   skills/store.ts   tasks/tasks.ts   knowledge/store.ts │
│  prompts/store.ts                                                  │
│  db/database.ts + db/schema.ts  (SQLite: sessions, messages, tools,    │
│      audit_logs, memories, tasks, task_steps, knowledge_docs,          │
│      knowledge_chunks, usage_log)                                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                     │  SDK calls
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
   OpenAI-compatible            Anthropic API              MCP servers
   (OpenAI / Ollama)            (Claude)                   (stdio/sse/http)
```

`*` The legacy `routes/tools.ts` mock catalog/execute endpoint was **removed**; its only
consumer (`ToolsPanel`) now uses the agent registry (see §7).

## 4. The agent loop (`backend/src/agent/core.ts`)

`AgentCore.run(userMessage)` is an async generator yielding stream events. It follows the
**DeepSeek-Harness Turn/Step model**: one user request = one **Turn**; each model request +
its tool executions = one **Step**. Every observable thing (user message, steering input,
injected context, model call + tokens, tool calls/results, approvals, completion, errors)
is appended to the **Session Log** (`session_events`) — the authoritative event stream from
which the trajectory view, replay, resume and telemetry all derive.

```
turn_start → user_message → context_injected → (model_call → [text | tool_call* → tool_result*])* → complete
```

- Each **step** calls the LLM (OpenAI-compatible by default, Anthropic if
  `provider === 'anthropic'`). Failed calls fall through to `config.fallbacks` (see §5b).
- The system prompt is assembled at turn start and logged as `context_injected`:
  `basePrompt + loadMemories() + loadSkills() + retrieveKnowledge(userMessage)`.
- Per-step token usage (from the provider `usage` object) is written to `usage_log` **and**
  attached to the `model_call` session event.
- **Tool pipeline**: per tool → `beforeToolCall` hook → approval gate → run (with a 120s
  timeout and retry-once for transient failures) → result logged. Read-only tools
  (`readOnly: true`, e.g. `list_files`, `web_search`, `calculator`, `weather`,
  `current_time`) declared safe run **in parallel**; approval-gated or stateful tools are
  barriers and run alone.
- **Steering**: a user message sent mid-run (via `POST /api/agent/steer`) is queued as a
  `steer` event and injected into the message history before the next step.
- Resume: `/api/agent/chat` reconstructs the exact model input from persisted
  `messages` rows (`loadMessages`), so a continued conversation matches what the model saw.
- If the model returns no tool calls, the answer is saved to `memories` and the loop ends
  with `complete`. `maxIterations` is 25 (set in `routes/agent.ts`).

### Event stream (`AgentStreamEvent`)
`thinking`, `text`, `tool_call`, `tool_result`, `approval_pending`, `error`, `complete`,
`done` — plus `turnIdx` / `stepIdx` framing on every event. The frontend
(`AgentChat.tsx` via `agentApi.chat`) reads the SSE stream and renders progress.

### Session Log (`backend/src/session/events.ts`)
Append-only table `session_events (session_id, seq, turn_idx, step_idx, type, role,
content, tool_name, args, result, model, tokens)`. `seq` is monotonic per session;
`GET /api/agent/trajectory` replays it grouped by turn/step for the UI's Trajectory
drawer. Invariant (from Harness): **anything the model saw is reconstructable from the
log**.

## 4b. Sub-agents & PTC (`backend/src/agents/delegate.ts`, `tools/agent-meta-tools.ts`)

- `delegate_task` — sub-agent delegation: a child gets a **scoped** context (read-only
  tools only: `scopedReadOnlyTools()`), runs its own short model loop, and returns its
  final answer. Keeps the parent's context clean for parallel investigations.
  The child loop now has **3 levels of resilience** (added by the user):
  L1 router loop, L2 **format-retry loop** (empty/malformed model output → inject
  correction hint, up to 3 retries), L3 **reflection loop** (tool/VM failure → stack
  trace injected into the next prompt, up to `errorBudget` attempts).
- `run_code` — **PTC (Programmatic Tool Calling)**: the model writes one TypeScript/JS
  program that composes many tool calls via a sandboxed `tools.call(name, args)` bridge,
  cutting model⇄tool round-trips. Runs in a `vm` sandbox (no fs/net); approval-gated.

## 4c. Workflow engine (`backend/src/workflow/*`) — LangGraph-style StateGraph

A **supervisor workflow** built on a tiny StateGraph runtime (no external deps):

- `graph.ts` — `StateGraph` (addNode/addEdge/setEntryPoint/`async *run`) executes a
  node graph, honoring conditional edges (`edge_fn`), a `maxSteps` budget, and
  exception routing (any thrown node error → `error` node). Nodes can **stream events
  live** through an `emit` channel (pumped to the caller before the node returns), while
  `state.pendingEvents` remains the post-return compatibility path.
  `buildSupervisorWorkflow()`
  wires the default graph: `router → supervisor | delegate | complete | error`,
  `supervisor → router (loop) | complete (done) | error`, `delegate → complete | error`,
  `complete/error → __end__`.
- `nodes.ts` — `routerNode` (LLM decides direct_reply / **loop** / delegate / done /
  error as JSON, with a **format-retry loop**: malformed/unknown-action output gets a
  correction hint injected and is retried up to 2 times before falling back to reply),
  `supervisorNode` (runs a full `AgentCore` ReAct loop inside the graph,
  **streaming** its process events live via `emit` and counting llm/tool calls),
  `delegateNode` (calls `delegateTask`, writes `state.subTasks`),
  `completeNode` (merges assistant text + sub-task results into the final answer),
  `errorNode` (records and decides recoverability).
- `shared/blackboard.ts` — global cross-agent blackboard (set/get/batch/clear) shared
  by router decisions, sub-task results, and error records.
- `routes/workflow.ts` — `POST /api/workflow/run` (SSE, same `AgentStreamEvent` schema
  as `/chat`) and `GET /api/workflow/graph` (graph description for debugging).
- Frontend: **工作流 mode toggle** in `AgentChat` — when on, the message is sent to
  `/api/workflow/run` instead of `/api/agent/chat`; the same trajectory/file-tracker
  events still apply.

## 5. Tool registry (`backend/src/tools/registry.ts`)

Single in-process registry. A registered tool is a `ToolDefinition`:

```ts
{ schema: ToolSchema, handler: ToolHandler, category, requiresApproval, enabled, readOnly? }
```

- `register(name, def)` — also upserts into the `tools` SQLite table.
- `unregister(name)` — removes from memory and the `tools` table (used when an MCP
  server disconnects).
- `getSchemas()` — enabled tools only; fed to the LLM as function/tool schemas.
- `executeTool(name, args, ctx)` — looks up the tool, enforces the **approval gate**,
  runs the handler, and writes an `audit_logs` row.
- `readOnly: true` marks tools safe for parallel execution (no state mutation).

### Approval gate
Tools with `requiresApproval: true` do not run immediately. On first call they return a
`PENDING_APPROVAL` result carrying an `approvalKey`. The UI shows an approve/deny control,
then calls `POST /api/agent/tools/approve` (or the global `POST /api/agent/settings/approval`
toggle to disable approvals entirely). The loop polls until approved, denied, or timed out.

### Tool categories registered today
| Category | Tools | Source file |
|----------|-------|-------------|
| utility / search / filesystem / development | `calculator`, `web_search`, `read_file`, `write_file`, `execute_code`, `weather`, `current_time` | `tools/builtin.ts` |
| tasks | `create_task`, `add_task_step`, `update_task_step`, `list_tasks`, `complete_task` | `tasks/agent-tools.ts` |
| computer | screen/UI automation tools | `computer-use/register-tools.ts` |
| mcp | `mcp__<server>__<tool>` (dynamic) | `mcp/manager.ts` |
| system | `run_command`, `list_files` | `tools/system-tools.ts` |
| agent | `delegate_task`, `run_code` (PTC) | `tools/agent-meta-tools.ts` |

## 6. Sessions, tasks, memory, audit (SQLite)

Tables (`backend/src/db/schema.ts`):

- `sessions` — one per conversation; `summary` is refreshed each agent turn.
- `messages` — `user` / `assistant` / `tool` / `system` rows; `tool_calls` and
  `tool_call_id` preserve the tool-conversation structure so history can be replayed.
- `tools` — registry mirror (name, category, enabled).
- `audit_logs` — every tool execution (input, output, permission, duration).
- `memories` — `semantic` notes saved at the end of each answered turn; re-injected by
  `loadMemories()` (top 10 by importance).
- `knowledge_docs` / `knowledge_chunks` — ingested documents and their chunks; the chunk
  row stores the embedding vector as JSON. `retrieveKnowledge()` does brute-force cosine
  search over these (no external vector DB).
- `usage_log` — per-turn token usage (`prompt_tokens`, `completion_tokens`, `total_tokens`,
  `model`) for cost reporting.
- `tasks` / `task_steps` — multi-step tracking. Progress auto-recomputes from completed
  steps; a task auto-completes at 100%.

### Task tools (agent-driven)
The agent uses `create_task` → `add_task_step` (×N) → `update_task_step` (running/completed)
→ `complete_task`. `TasksPanel` reads the same `tasks` table, so the UI mirrors the agent's
plan in real time.

## 7. MCP client (`backend/src/mcp/*`)

- `store.ts` — JSON file store at `backend/data/mcp_servers.json`. Seeds a disabled
  "Memory" stdio server. `McpServerConfig`: `{ id, name, transport: 'stdio'|'sse'|'http',
  command?, args?, url?, env?, autostart?, enabled? }`.
- `manager.ts` — `McpManager` singleton:
  - `connect(id)` builds the right transport (`StdioClientTransport` / `SSEClientTransport` /
    `StreamableHTTPClientTransport`), connects a `Client`, calls `listTools()`, and
    registers each as `mcp__<serverName>__<toolName>` in the tool registry with
    `requiresApproval: true`. The handler wraps `client.callTool(...)`.
  - `disconnect(id)` unregisters the bridged tools and closes the client.
  - `autostart()` connects every server flagged `autostart` on boot (non-blocking).
- `routes/mcp.ts` — `GET /`, `POST /` (add + validate), `POST /:id/connect`,
  `POST /:id/disconnect`, `GET /:id/tools`, `DELETE /:id`.
- `McpPanel.tsx` — real UI: lists server statuses, live tool counts, connect/disconnect/delete.

### Why ToolsPanel was re-pointed
`ToolsPanel` used to call the legacy `routes/tools.ts` mock catalog (`translator`,
`summarizer`, `timer` — fake). It now reads `GET /api/agent/tools` and executes via
`POST /api/agent/tools/execute`, so it shows the agent's **actual** registry — builtin
tools, task tools, and any connected MCP tools — and runs them for real. See
`src/components/ToolsPanel.tsx` and `src/api/client.ts` (`agentApi`, not `toolsApi`).

## 8. Skills backend (`backend/src/skills/*`)

- `store.ts` — JSON store at `backend/data/skills.json`. Seeds "Web Research" and
  "Code Debug" (both reference real tools: `web_search`, `read_file`, `write_file`).
  `Skill`: `{ id, name, description, when, steps[], createdAt, updatedAt }`.
- `routes/skills.ts` — `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`.
- `core.ts` `loadSkills()` injects each skill as a procedure block into the system prompt,
  gated by its `when` condition. `SkillsPanel.tsx` is the CRUD UI.

## 9. Computer-use (`backend/src/computer-use/*`)

A macOS-only bridge: `register-tools.ts` exposes tools whose handlers shell out to
`osascript` (AppleScript) for screen/UI automation. Non-macOS calls return a friendly
"unsupported" message. Frontend: `ComputerPanel.tsx`.

## 10. Knowledge base (RAG) — `backend/src/knowledge/*`

Local-first and now **fully user-configurable**. Every layer of the RAG pipeline is driven
by a single config row (`rag_config` table, id `default`):

| Layer | Config field | Options |
|-------|--------------|---------|
| Embedding model | `embeddingModel` | any OpenAI-compatible (e.g. `text-embedding-3-small/-large`, `nomic-embed-text`, `bge-m3`) |
| Embedding provider | `embeddingBaseUrl` / `embeddingApiKey` | OpenAI / Azure / Ollama / any `/embeddings` endpoint |
| Chunk size / overlap | `chunkSize` / `chunkOverlap` | numbers (chars) |
| Chunk strategy | `chunkStrategy` | `paragraph` \| `sentence` \| `recursive` \| `token` |
| Retrieval mode | `retrievalMode` | `dense` (vector) \| `hybrid` (vector + BM25) |
| Rerank | `rerankEnabled` | two-pass lexical rerank toggle |
| Retrieval tuning | `topK` / `scoreThreshold` | numbers |
| Index backend | `indexBackend` | `bruteforce` (JS) \| `sqlitevec` (native, auto-fallback) |

- `store.ts`
  - `getConfig()` / `updateConfig()` read/write the `rag_config` row (env vars are only the
    *default* fallback for `embeddingBaseUrl`/`embeddingApiKey`/`embeddingModel`).
  - `chunkText(text, {size, overlap, strategy})` implements the four strategies.
  - `embed()` calls the OpenAI-compatible `/embeddings` endpoint using the per-config
    base URL / key / model. (A test seam `__setEmbedOverride` allows deterministic
    embeddings in unit tests.)
  - **Embedding versioning** — `rag_config.embedding_version` is bumped automatically when
    the model/provider changes; chunks are stamped with the version they were embedded with
    and search ignores stale vectors until `rebuildIndex()` re-embeds them.
  - `search(query, {topK, threshold})` — industrial **two-phase retrieval**: candidate
    generation (dense cosine **or** SQL KNN via sqlite-vec; `hybrid` adds normalized BM25
    via `bm25All`), then optional rerank pass on a bounded candidate set re-scored by
    lexical overlap (`lexicalOverlap`). Filters `score > scoreThreshold`, returns top `topK`.
  - `rebuildIndex()` — re-chunks + re-embeds the whole KB from each doc's stored
    `raw_text`. **Required after switching the embedding model** (vector dimensions change).
  - `indexStatus()` / `effectiveBackend()` — report which backend is actually active;
    `sqlitevec` is used only when the native extension loads, otherwise it falls back to
    brute-force automatically (search always works).
- `vec.ts` — the sqlite-vec integration: loads the native extension (npm `sqlite-vec`
  `load()` → `SQLITE_VEC_PATH` env → bare names), manages the `vec0` virtual table
  (cosine metric, auto drop+recreate on dimension change), and exposes `knn()`
  (BigInt rowids) + `syncVecIndex()`. `syncVecIfActive()` keeps the vec table in sync on
  ingest / rebuild / delete / config switch.
- `routes/knowledge.ts` — `POST /ingest` (text or URL, **sync or `async: true` → job
  queue with `GET /ingest/jobs`**), `GET /docs`, `POST /search`, `DELETE /docs/:id`, plus
  `GET/PUT /config`, `POST /rebuild`, `GET /index`, `POST /index/sync`.
- Wired into the loop: `AgentCore.retrieveKnowledge(userMessage)` reads the config's
  `topK`/`scoreThreshold` and appends the top chunks to the system prompt. If the embedding
  service is unreachable it degrades gracefully (empty context) so the agent keeps working.
- UI: **Knowledge Base** section inside `Settings.tsx` (no new tab) now contains a
  "RAG Configuration" panel — embedding model/provider/key, chunk settings, retrieval mode,
  rerank, top-K/threshold, index backend — with **Save configuration** and **Rebuild index**
  buttons, plus a floating **? help button** (`components/RagHelp.tsx`) with
  功能介绍 / 操作注意事项 / 常见问题 (full guide in `docs/RAG_GUIDE.md`).

## 11. Multi-model failover & comparison

- **Failover** — `AgentCore.callLLM()` builds a chain `[primary, ...config.fallbacks]`
  where each fallback is `{ provider, model, baseUrl, apiKey }`. The first that returns a
  response wins; failures fall through. `fallbacks` is passed from the `/chat` body.
- **Compare** — `POST /api/agent/compare` takes `{ message, targets[] }` and runs a single
  (no-tools) completion against each target model in parallel, returning an array
  `{ provider, model, ok, text | error }`. Useful for A/B-ing models in the UI.

## 12. Prompts & Voice

- **Prompts** — `prompts/store.ts` (JSON at `backend/data/prompts.json`) holds reusable
  prompts with name/content/variables/version. `routes/prompts.ts` exposes
  `GET/POST/PUT/DELETE /api/prompts`. The **Prompt Library** section in `Settings.tsx`
  lets you save presets and apply them as the agent system prompt (no separate panel).
- **Voice** — `routes/voice.ts`: `POST /api/voice/tts` (text → audio via OpenAI-compatible
  `audio.speech`) and `POST /api/voice/stt` (audio → text via `audio.transcriptions`).
  UI shipped: **Voice** sidebar tab (`components/VoicePanel.tsx`) — text→speech with
  voice picker + playback, and mic recording→STT via MediaRecorder (base64 → `/voice/stt`).

## 12d. 全平台客户端（Tauri v2：桌面 + 移动）

- **选型**：Tauri v2 是唯一能用一套 React 代码覆盖 Windows/macOS/Linux 桌面 + iOS/Android
  移动端的方案（移动端用系统 WebView 渲染，Rust 核心共享）。`src-tauri/` 为基础配置
  （tauri 2.11.5，main.rs 为标准壳），icons 全套已生成（含 Android/iOS 各尺寸）。
- **网络双模式**：移动端沙盒禁止本地 Node 进程 → `src/apiConfig.ts`（`getApiBase`/`apiUrl`）：
  Tauri 环境（`window.__TAURI_INTERNALS__`）默认 `http://localhost:3001`；Web 开发走相对
  路径 vite 代理；`Settings → 通用 → API 服务器地址` 可填远程地址（持久化
  `localStorage['api_base_url']`），切换后 `applyApiBase()` 更新 axios 实例。所有手动
  fetch 统一改走 `apiUrl()`（ModelManager 审批、ComputerPanel/McpPanel/SkillsPanel/Tasks/
  AgentChat approve、SSE 路由）。
- **响应式**：App 布局加移动顶栏（<768px 汉堡）+ 抽屉遮罩；Sidebar 移动端 off-canvas
  （`-translate-x-full md:translate-x-0`，`mobileOpen`/`onMobileClose` props）；main
  `pt-14 md:pt-0` + `md:ml-56/16`。平板/横屏用 md 断点保持桌面式侧栏。
- **构建**：cargo check 通过（需 Rust ≥1.85 / edition2024；本机注意 brew rustc 1.84 与
  rustup 1.97 冲突，用 `PATH="$HOME/.cargo/bin:$PATH"` 前缀）。移动端需 Android SDK /
  Xcode+CocoaPods，详见 `docs/CLIENT_BUILD.md`（含 Android INTERNET 权限、iOS ATS/HTTPS）。

## 12c. i18n（多语言，默认英语）

- **机制**：`react-i18next` + `i18next`（`src/i18n/index.ts`），7 种语言资源
  `src/i18n/locales/{en,ja,ko,zh-CN,zh-TW,bo,fa}.ts`，扁平 key（`nav.chat`、
  `trajectory.evt.tool_call`、`chat.placeholder` …），`fallbackLng: 'en'`（缺失 key
  回退英文，再缺失显示 key 本身，界面不会空白）。
- **切换**：`Settings → Language` 七选一，持久化 `localStorage['language_preference']`
  （默认 `'en'`），`i18n.changeLanguage` 立即全站生效；`applyDocLang` 同步
  `<html lang>` 与 `dir`（波斯语 `fa` 为 RTL，文本流自动翻转）。
- **覆盖**：导航、Settings 分区、轨迹面板事件类型、各工具面板标题/按钮/空态/错误提示、
  AgentChat 标题/占位符均已 t() 化；组件内 `useTranslation()`，模块级辅助函数通过
  参数传递 `t`（如 WorkspacePanel 的 listFiles/readFileContent/getRoot）。
- **测试**：`src/i18n/index.test.ts`（默认 en、持久化切换、7 语言支持、fa RTL、
  缺失 key 回退、非法值回退）；组件测试断言基于默认 en。

## 12b. Theming（深色 / 浅色 / 跟随系统）

- **机制**：Tailwind v4 的 `@theme` 把颜色定义为 CSS 变量（`--color-bg-dark` 等），工具类
  （`bg-bg-dark` / `text-text-primary` / `border-border` …）以 `var()` 引用它们 ——
  所以**运行时覆盖变量即可整站换肤**。`index.css` 的 `:root[data-theme='light']` 提供浅色
  覆盖层；`data-theme='dark'` 使用 `@theme` 默认值（深色）。
- **src/theme.ts**：`get/setThemePreference`（localStorage `theme_preference`，
  默认 `'system'`）、`resolveTheme`（system → `matchMedia('(prefers-color-scheme: dark)')`）、
  `applyTheme`（写 `<html data-theme>`）、`initTheme`（main.tsx 在渲染前调用防闪烁，
  并在 system 模式下监听系统主题变化）。强调色同样持久化（`--color-primary` 覆盖）。
- **UI**：`Settings → Theme`（`renderThemeSection`）三选一（跟随系统/浅色/深色）+ 6 色强调色。

## 13. Desktop packaging (Tauri, v2)

To ship a real installable binary (vs. the dev `vite` + `tsx` server), a Tauri v2 scaffold
lives in `src-tauri/`:

- `tauri.conf.json` (window + `devPath: http://localhost:5173`, `distDir: ../dist`),
  `Cargo.toml`, `build.rs`, `src/main.rs`, `capabilities/default.json`.
- `package.json` adds `tauri` (`dev`), `tauri build` scripts.

> **Note:** building a binary requires the Rust toolchain + network access for crates, so
> it cannot run in this sandbox. The scaffold is complete and documented; run
> `npm run tauri dev` / `npm run tauri build` on a machine with Rust installed.

## 14. API surface (selected)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/agent/chat` | Run the agent (SSE stream of `AgentStreamEvent`) |
| GET  | `/api/agent/tools` | List registered tools (name, category, schema, approval) |
| POST | `/api/agent/tools/execute` | Execute one tool directly |
| POST | `/api/agent/tools/approve` | Approve/deny a pending tool |
| GET/POST | `/api/agent/settings/approval` | Read/toggle global approval requirement |
| POST | `/api/agent/test-openai` `/test-anthropic` | Provider connection tests |
| GET  | `/api/sessions` `POST /sessions` `GET /sessions/:id/messages` `DELETE /sessions/:id` | Session CRUD + history |
| GET  | `/sessions/:id/audit` `/memories` | Audit log + memories for a session |
| GET/POST/PUT/DELETE | `/api/tasks` … | Task + step CRUD |
| GET/POST `/:id/connect` `/disconnect` `DELETE /:id` | `/api/mcp` … | MCP server management |
| GET/POST/PUT/DELETE | `/api/skills` … | Skill CRUD |
| POST | `/api/knowledge/ingest` `GET /docs` `POST /search` `DELETE /docs/:id` | Knowledge base (RAG) |
| POST | `/api/knowledge/ingest {async:true}` + `GET /ingest/jobs[/:id]` | Async ingestion (off the request path) |
| GET/PUT | `/api/knowledge/config` | Read / update RAG config (model, chunking, retrieval, index) |
| POST | `/api/knowledge/rebuild` | Re-embed the whole KB with the current config |
| GET  | `/api/knowledge/index` | Report active index backend (configured / effective / vec status) |
| POST | `/api/knowledge/index/sync` | Rebuild the sqlite-vec table from stored embeddings (no API calls) |
| GET/POST/PUT/DELETE | `/api/prompts` … | Prompt library CRUD |
| POST | `/api/voice/tts` `/api/voice/stt` | Text→speech / speech→text |
| GET  | `/api/agent/search?q=` | Full-text search across messages |
| POST | `/api/agent/fork` | Copy a session's messages into a new session |
| GET  | `/api/agent/tokens?sessionId=` | Token usage totals for a session |
| POST | `/api/agent/compare` | Run one prompt against many models (side-by-side) |
| GET  | `/api/agent/trajectory?sessionId=` | Session Log replay grouped by turn/step (what the model saw) |
| POST | `/api/agent/steer` | Queue a user message the running agent injects before its next step |
| POST | `/api/workflow/run` | Run the supervisor StateGraph for a message (SSE) |
| GET  | `/api/workflow/graph` | Describe the workflow graph (nodes/edges) |
| GET  | `/api/health` | Health check |
| POST | `/api/code/*` `/image/*` `/video/*` `/ollama/*` `/model/*` | Auxiliary generators/providers |

## 11. Build & run

```bash
# Frontend
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run build      # tsc -b && vite build  → dist/

# Backend
cd backend
npm install
npm run dev        # tsx watch src/server.ts  (http://localhost:3001)
npm run build      # tsc --noEmit (type-check)
```

Frontend expects the backend on `:3001` (proxied via `/api` in dev). Configure the LLM
provider/key in `Settings` (stored in `localStorage`) or via backend env
(`OPENAI_BASE_URL`, `OPENAI_API_KEY`). For RAG, set `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY`
/ `EMBEDDING_MODEL` (default to the OpenAI ones).

### Tauri (desktop build)

```bash
npm run tauri dev    # launches the web UI inside a native window (needs Rust toolchain)
npm run tauri build  # produces a platform installer in src-tauri/target/release/
```

## 15. Known limitations / next steps

- The **workflow engine** (StateGraph) is wired and **streams events live**: nodes can
  `emit()` mid-execution (the event channel pumps them to the caller before the node
  returns), so 工作流 mode has the same typing effect as `/chat`. The router can choose
  `loop` (→ supervisor ReAct) / `delegate` / `direct_reply` / `done` / `error`, with a
  **format-retry loop** for malformed routing JSON. Remaining: `supervisorNode` filters
  `text` events (the final answer is emitted once by `completeNode`).
- **FileTracker** (`file_modified` SSE → right panel) works for `write_file` /
  `run_code`-detected writes; `delete` operations are typed but not yet emitted by any tool.
- `sqlitevec` is a real, wired accelerator on this machine (the npm `sqlite-vec` binary
  loads and KNN queries work); on machines without the native binary it falls back to
  brute-force automatically. Embedding **versioning** means stale vectors are ignored until
  `rebuildIndex()`.
- The sub-agent (`delegate_task`) currently only gets read-only tools; file-editing children
  with an approval policy are a follow-up. `run_code` (PTC) is a sandboxed programmatic-tool-
  calling bridge, not a full code execution engine.
- Steering injects queued messages before the next step; a "steer receipt" (confirming which
  model request actually saw it) is visible in the trajectory log but not surfaced as an
  explicit UI ack yet.
- Computer-use is macOS-only.
- MCP tools always require approval; per-tool approval policies are not yet configurable.
- Voice endpoints exist but have no UI yet (mic/speaker buttons are a small follow-up).
- Tauri packaging is scaffolded but not built here (needs Rust + network).
- The legacy `routes/tools.ts` mock catalog was removed; `ToolsPanel` uses the agent registry.
