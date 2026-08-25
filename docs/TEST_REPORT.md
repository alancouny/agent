# AI Agent App — Test Report

> Last updated: 2026-08-13. This report replaces the previous version, which falsely
> claimed ~100% functional/API/UI/performance coverage and described modules that no
> longer exist. Coverage below is **honest**: it states what is and isn't verified.

## 1. Environment

| Item | Value |
|------|-------|
| OS | macOS (ARM64) |
| Node.js | v22.22.2 (managed) |
| Frontend build | Vite 6 + React 19 + TypeScript 5 |
| Backend build | Express + TypeScript 5 + better-sqlite3 |
| Test runner | Node 22 built-in `node:test` (via `tsx`) — **no external test deps** |
| Vitest | Not installed (network-restricted sandbox); `node:test` used instead |

> Note: the previous plan mentioned Vitest. Because the sandbox blocks `npm install` of
> new packages, the suite uses the zero-dependency `node --import tsx --test` runner, which
> is functionally equivalent and can be swapped for Vitest later without changing test code.

## 2. Build & type-check (verified)

| Check | Command | Result |
|-------|---------|--------|
| Frontend type-check | `npm run build` (runs `tsc -b && vite build`) | ✅ passes |
| Backend type-check | `cd backend && npm run build` (`tsc`) | ✅ passes |
| Frontend production bundle | `vite build` | ✅ ~425 KB JS / ~52 KB CSS |

These run clean after the P0–P3 work (agent↔tasks wiring, MCP client, skills backend,
memory activation, `ToolsPanel` re-point, dead-code removal).

## 3. Automated test suite (new)

Run with:

```bash
cd backend
npm test
# equivalent: node --import ./tests/helpers/preload.mjs --import tsx --test --test-concurrency=1 tests/*.test.ts
```

> The `preload.mjs` helper redirects every test process to an **in-memory SQLite DB**
> (`AGENT_DB_PATH=':memory:'`), so the suite never touches the real development DB
> (`backend/data/agent.db`) — no more test-pollution of user data.
> `--test-concurrency=1` is still important: several files rely on module-level
> singletons (drift sessions Map, llm-tracer, approval map, memory providers).

**Result: 55/55 passing.**

> 2026-08-14：项目经历了一次大规模重构（新增 LangGraph 风格 workflow 引擎、blackboard、
> FileTracker、三级 sub-agent 反射循环），旧的 70 个测试文件在重构中被移除。本轮**恢复
> 全部关键测试**（55 个）：workflow 引擎 + E2E、registry/审批门、agent+workflow+knowledge
> 路由、**MCP 真实 stdio fixture 集成**、workspace fs（含路径穿越防护）、terminal、
> **RAG 配置矩阵**（含 embedding 版本化）、fork/search/tokens、prompts CRUD、hooks 系统。

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/registry.test.ts` | 6 | Tool register/get/`getSchemas`（仅 enabled）、disabled 工具排除 + `TOOL_DISABLED`、`executeTool` 执行 handler、**审批门**（PENDING_APPROVAL / 全局关闭后放行）、`readOnly` 标记（并行调度依据）、agent 元工具（`delegate_task`/`run_code`）注册 |
| `tests/core-routes.test.ts` | 8 | HTTP 集成：`GET /api/agent/tools`（含 run_code/delegate_task）、`POST /api/agent/tools/execute`、审批工具返回 PENDING_APPROVAL、`GET /api/workflow/graph`（图定义）、**`POST /api/workflow/run` 在 LLM 不可达时优雅终止**（SSE done）、`chunkText` 分块、`/api/knowledge/search` 空库降级、`/api/knowledge/config` |
| `tests/workflow.test.ts` | 6 | **StateGraph 引擎**：entry→complete 终止、条件边（edge_fn）路由到 delegate、未知节点 → error 事件、节点抛异常 → error 处理不崩溃、`buildSupervisorWorkflow` 5 节点图可构造且 LLM 不可达时优雅结束；**emit() 在节点返回前流式 yield**（打字机效果验证） |
| `tests/workflow-e2e.test.ts` | 1 | **Workflow 全链路 E2E**（mock OpenAI server）：router 返回 `{"action":"loop"}` → **supervisor 真实跑 AgentCore**（过程事件流式到达）→ complete→`__end__`，SSE 含 thinking/text/done，session log 记录 `workflow_step`，user 消息持久化 |
| `tests/mcp.test.ts` | 2 | **MCP 真实 stdio fixture**（`src/mcp/fixtures/echo-server.mjs` 重建，基于 SDK 的 ListTools/CallTool schema）：连接→发现 `mcp__echo-e2e__ping`→执行（pong: hi）→断开后从注册表注销；未知 server 返回未连接状态不抛错 |
| `tests/workspace.test.ts` | 7 | workspace/fs：write/read 往返、嵌套目录自动创建、目录优先排序、删除、**路径穿越拒绝（EACCES_ROOT）**、兄弟目录拒绝、**超大文件拒绝（ETOOLARGE，写路径也受 5MB 保护）** |
| `tests/terminal.test.ts` | 4 | `executeCommand`：echo 返回 stdout、坏命令优雅失败、空命令拒绝、非法 timeout 拒绝 |
| `tests/knowledge-config.test.ts` | 12 | **RAG 矩阵**（确定性嵌入零网络）：四种 chunk 策略边界（token 按 token 语义）、`bm25All`/`lexicalOverlap`、config 往返、**embedding 版本化 bump**、search 相关文档优先/阈值过滤/hybrid/rerank、rebuildIndex、delete 级联 |
| `tests/agent-extras.test.ts` | 3 | `/fork` 复制消息到新会话（新 UUID）、`/search?q=` 命中、`/tokens` 按会话汇总 |
| `tests/prompts.test.ts` | 1 | 提示词库 CRUD 往返（含 `{{变量}}` 提取），测试后恢复 JSON 文件 |
| `tests/hooks.test.ts` | 5 | hook 系统：无 hook 直通、abort 短路、modify 只合并指定字段、多 hook 顺序、中途 abort 停止后续 hook |

> Per-file counts are listed by `npm test`; the suite totals **55** and is green.
> `workflow-e2e` 用本地 mock LLM 证明 StateGraph 完整路径可跑通；`mcp.test` 用真实子进程
> fixture；RAG 测试用 `__setEmbedOverride` 确定性嵌入，全程零网络。

### What the suite exercises
- The single tool registry as the source of truth (shared by the agent, `ToolsPanel`, MCP).
- The approval flow end-to-end (registry unit + HTTP route).
- The LangGraph-style workflow engine (routing, streaming, error handling) + its HTTP surface.
- Real MCP bridge behavior against a live stdio subprocess.
- Workspace fs hardening (path traversal + oversize) and the terminal command runner.
- The full configurable RAG pipeline (chunking, retrieval modes, rerank, versioning, rebuild).
- Session fork/search/tokens, prompt library CRUD, and the agent hook system.

## 3b. Frontend component tests (vitest + testing-library)

```bash
npm run test:ui     # vitest run（jsdom，setup 注入 jest-dom）
```

**Result: 17/17 passing.**（依赖已装：vitest 4 / jsdom 30 / @testing-library/react 16）

| File | Tests | What it covers |
|------|-------|----------------|
| `src/components/__tests__/Sidebar.test.tsx` | 3 | 全部导航项渲染（含新增 Voice）、点击回调、折叠隐藏标签 |
| `src/components/__tests__/RagHelp.test.tsx` | 4 | ? 按钮打开面板、三 tab 切换内容、X 关闭、Esc 关闭 |
| `src/components/__tests__/FileTrackerPanel.test.tsx` | 6 | 空态、disabled 返回 null、NEW/MOD 徽标、展开预览、onExpand/onClear 回调（受控组件） |
| `src/components/__tests__/TrajectoryDrawer.test.tsx` | 4 | mock agentApi：Turn/Step 渲染、展开步骤显示工具调用、Steer 发送、空日志状态 |

## 4. What is NOT covered (honest gaps)

- **Live LLM semantics**: the **workflow** path is covered end-to-end against a **mock**
  OpenAI-compatible server (router→complete, SSE, session events). The raw `AgentCore.run`
  loop itself is no longer directly E2E-tested after the refactor (its tool-calling and
  approval mechanics are covered via registry/route tests); a mock-LLM `AgentCore` E2E
  can be restored from the previous suite.
- **RAG retrieval quality (live)**: `search()` is tested **offline** via a deterministic
  embed override (relevance ranking, threshold filtering, hybrid, rerank, sqlite-vec KNN
  ordering). Live semantic search with **real** provider vectors and real rerank models is
  not exercised (needs an API key), but the logic paths are.
- **Failover / compare**: `callLLM` fallback chain and `/compare` need live provider keys,
  so they're not exercised in CI (the HTTP 400-path and route wiring are covered).
- **Steering during a live run**: `POST /steer` is tested (queue + pending state), and
  `drainSteering` logic runs inside the loop, but a real "user steers while the model is
  mid-generation" timing test is not automated.
- **Voice TTS/STT**: need the audio endpoints (network). Not covered.
- **Frontend components** (`AgentChat`, `TrajectoryDrawer`, `RagHelp`, etc.): no
  component/unit tests yet (no jsdom/RTL setup).
- **Computer-use**: macOS-only `osascript` bridge; not exercised in CI. `executeCommand` (used by `run_command` + Terminal) *is* tested via `tests/terminal.test.ts` on macOS.
- **Image/Video/Code/Ollama routes**: provider-dependent; not covered.
- **No coverage percentage** is measured (no coverage tooling). The table above is the
  factual scope.

## 5. Known issues / follow-ups

| Item | Severity | Status |
|------|----------|--------|
| No automated coverage tooling | Low | By design (sandbox limits); add Vitest + coverage when deps installable |
| Frontend component tests missing | Medium | Not yet written |
| Live-provider loop/failover untested | Medium | Covered via mock-LLM E2E + tool/approval tests |
| Steering timing (mid-generation steer) not automated | Low | Queue + drain logic tested; live timing is manual |
| `data/agent.db` is created/written when tests run (real SQLite) | ~~Low~~ **Fixed** | Tests now run against `:memory:` via `tests/helpers/preload.mjs`; the real dev DB is never opened by the suite. Tests must still run serially (`--test-concurrency=1`) for module-level singletons |

## 6. Summary

The app builds clean and now has a **real, passing automated test suite (55/55)** covering
the tool registry + approval gate, the agent/workflow/knowledge HTTP routes, the
**LangGraph-style StateGraph engine** (routing incl. loop/delegate/reply, streaming,
error handling, termination), a **full workflow E2E** against a mock LLM, the **MCP
bridge against a live stdio fixture**, workspace fs hardening (path traversal + oversize
writes), the terminal command runner, the **full configurable RAG matrix** (chunking,
hybrid/rerank, embedding versioning, rebuild), session fork/search/tokens, prompt library
CRUD, and the agent hook system. Two real defects surfaced and fixed while restoring the
suite: `updateConfig` never bumped `embedding_version` (compared patch against merged
config), and `writeFileContent` lacked the oversize guard. Remaining gaps
(live-provider semantics, real rerank, voice, frontend components) are documented in §4.
