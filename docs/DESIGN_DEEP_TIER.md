# 深度重构档设计文档（Deep-Tier Refactor）

> 对应 `docs/ARCH_REVIEW.md` 路线图「🏗️ 深度重构（3-6周）」四项 + 一条配置清理
> 交付日期：2026-08-25 · 关联提交基线：`ad448a8`（中等档）

## 一、概述

| 编号 | 项 | 类型 | 状态 |
|---|---|---|---|
| D0 | 清理 6 条 MCP 死配置 | 配置清理 | ✅ |
| D1 | `routes/agent.ts` 按域拆分 | 结构重构 | ✅ |
| D2 | AgentCore 事件总线解耦 | 架构解耦 | ✅ |
| D3 | 前端状态层（zustand） | 状态管理 | ✅ |
| D4 | API key keychain 化 | 安全加固 | ✅ |

目标：把中等档（已交付 R1-R5）尚未触及的「深度档」四项真正落地——核心是消除 `core → 传输层` 的硬编码耦合、统一前端全局状态源、把密钥从明文落盘升级为受控存储，并顺手清理历史噪音配置。

所有改动均保持既有测试零破坏性：路径语义不变、localStorage 键名不变、SSE 帧格式不变。

---

## 二、D0 — 清理 6 条 MCP 死配置

**问题**：`backend/data/mcp_servers.json` 含 6 条 `echo-e2e` 配置，均指向不存在的 `self_write/.../echo-server.mjs`，且 `autostart: false` 永不启动，属于历史残留噪音。

**改动**：
- 删除全部 6 条 `echo-e2e` 配置，仅保留 `mcp-memory` 一条有效 server。
- 无代码引用这些配置；`mcp.test.ts` 自带 fixture 备份/恢复，不依赖真实文件内容。

**风险**：无。属于纯删减，不影响任何运行时路径。

---

## 三、D1 — `routes/agent.ts` 按域拆分

**问题**：原 `routes/agent.ts` 为 480 行巨型路由文件，token 估算逻辑重复定义，单文件职责过载，难以维护与评审。

**设计（barrel 模式）**：

```
backend/src/routes/agent/
├── chat.ts        # POST /           流式聊天（SSE）
├── tools.ts       # GET /  POST /execute  POST /approve  GET /approval-state
├── approval.ts    # GET /approval  POST /approval（confirm:true 门）
├── models.ts      # POST /test-openai  /test-anthropic  /compare
├── sessions.ts    # GET /search  POST /fork  GET /tokens  GET /trajectory  POST /steer
├── context.ts     # GET /state  POST /compress
└── index.ts (即 agent.ts 重写为 barrel)
```

`agent.ts` 重写为 barrel，路径语义与原先完全一致：

```typescript
export const agentRouter = Router();
agentRouter.use('/chat',    chatRouter);
agentRouter.use('/tools',   toolsRouter);
agentRouter.use('/settings',approvalRouter);
agentRouter.use('/',        modelsRouter);
agentRouter.use('/',        sessionsRouter);
agentRouter.use('/context', contextRouter);
```

**验证**：`core-routes.test.ts` 的 `/chat` 用例零改动全绿；路由注册顺序保证与原表等价。

---

## 四、D2 — AgentCore 事件总线解耦

**问题**：`AgentCore.run()` 原本是 `AsyncGenerator<AgentStreamEvent>`，SSE 路由、`experiments.ts`、`workflow/nodes.ts` 各自 `for await` 迭代，导致 core 与传输层（SSE 帧、HTTP 响应）硬编码耦合，无法独立测试，也难以接入新消费者。

**设计**：引入类型化事件总线，把「产生事件」与「消费事件」彻底分离。

`backend/src/agent/event-bus.ts`：

```typescript
export class AgentEventBus extends EventEmitter {
  constructor() {
    super();
    this.on('error', () => {}); // 吞掉 EventEmitter 对 type==='error' 的特殊抛出
  }
  emitEvent(event: AgentStreamEvent): boolean {
    this.emit('event', event);          // 通用频道
    this.emit(event.type, event as any); // 按 type 分频道
    return true;
  }
  onEvent(handler: (e: AgentStreamEvent) => void): this { return this.on('event', handler as any); }
  onType<T extends AgentStreamEvent['type']>(type: T, handler: (e: Extract<AgentStreamEvent,{type:T}>) => void): this {
    return this.on(type, handler as any);
  }
}
```

`core.ts` 改造：

```typescript
// 旧：async *run(userMessage): AsyncGenerator<AgentStreamEvent>
// 新：
async run(userMessage: string, opts?: { eventBus?: AgentEventBus }): Promise<void> {
  const bus = opts?.eventBus ?? new AgentEventBus();
  const emit = (event: AgentStreamEvent) => bus.emitEvent(event);
  // 所有 yield { ... } 改为 emit({ ... })
}
```

**消费者改造**：
- `routes/agent/chat.ts`：构造 `new AgentEventBus()`，`bus.on('event', ev => res.write('data: ...'))`，再 `await streamAgent.run(message, { eventBus: bus })`，结尾写 `done`/`error` 帧。
- `routes/experiments.ts` / `workflow/nodes.ts`：由 `for await (const ev of agent.run(...))` 改为 `bus.on('event', ...)` + `await agent.run(..., { eventBus: bus })`。

**验证**：新增 `tests/event-bus.test.ts`；`core-routes.test.ts` SSE 帧格式不变仍绿。

---

## 五、D3 — 前端状态层（zustand）

**问题**：面板间靠 `props` + `localStorage` 散传；`ApiSettings` 在 `App`/`ModelManager`/`ExperimentLab`/`WorkspacePanel` 四处各自读写同一份 `agent_api_settings`，存在双数据源风险（评审 #6）。

**设计**：引入单一全局状态源 `src/store/useAppStore.ts`（zustand v5 + `persist` + `createJSONStorage`）。

```typescript
interface AppState {
  apiSettings: ApiSettings;
  sessionId: string | null;
  activeTab: TabKey;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  // setters ...
}
```

- `partialize` 仅持久化 `apiSettings` + `sessionId` 到 localStorage 键 `agent_api_settings`——**键名与改造前完全相同，用户数据零迁移**。
- `DEFAULT_API_SETTINGS = { baseUrl:'https://api.openai.com/v1', apiKey:'', model:'gpt-4o', format:'openai' }`。

**消费者收敛**：
- `App.tsx`：移除本地 `useState`/`useLocalStorage`/`ApiSettings` 接口，改走选择器（含 `toggleSidebar`/`setMobileNavOpen`）。
- `ModelManager.tsx`：`useAppStore((s) => s.apiSettings)` 替代 `useLocalStorage<ApiSettings>`。
- `ExperimentLab.tsx`：`apiKey`/`baseUrl` 经 `useAppStore.getState().apiSettings` 初始化。
- `WorkspacePanel.tsx`：`getApiBase()` 读取 `useAppStore.getState().apiSettings`；删除本地 `ApiSettings` 接口。

**验证**：新增 `src/store/useAppStore.test.ts`；前端 `tsc` 0 错误；既有 `AgentChat`/`Settings` 等测试全绿。

---

## 六、D4 — API key keychain 化

**问题**：评审 #21 指出 API Key 明文落盘（localStorage / `rag_config` 等）；中等档已实现「默认随机 key + 强制鉴权」（R4/#23），但落地存储仍是随机生成后直接存环境变量，缺少受控、可替换的密钥存储抽象。

**设计**：可插拔 `KeyStore` 接口，默认文件存储 + 可选系统钥匙串（Tauri/OS keyring）回退。

`backend/src/security/keystore.ts`：

```typescript
interface KeyStore {
  getOrCreate(): { key: string; created: boolean };
  get(): string | null;
}
export class FileKeyStore implements KeyStore { /* data/.agent_key, 0600, AGENT_KEY_FILE 可覆盖 */ }
export class OsKeyStore implements KeyStore {      /* 懒加载 @napi-rs/keyring，失败回退 FileKeyStore */ }
export function getKeyStore(): KeyStore { /* 单例 */ }
export function _resetKeyStoreForTest(): void { /* 测试隔离 */ }
```

`server.ts` `ensureApiKey()` 改造：

```typescript
const store = getKeyStore();
const { key, created } = store.getOrCreate();
if (created) { /* 仅在首次生成时明文打印到控制台 */ }
else { logger.info('Using persisted AGENT_API_KEY from secure storage'); }
```

**当前落地状态**：
- `FileKeyStore` 默认启用，密钥以 `0600` 权限落盘 `data/.agent_key`，替代原先「随机生成即忘」的无持久化状态。
- `OsKeyStore` 已就绪，但因 `@napi-rs/keyring` 尚未安装，当前路径在懒加载失败时回退 `FileKeyStore`。待 `npm i @napi-rs/keyring`（或 Tauri 集成）后自动启用系统钥匙串。

**验证**：新增 `tests/keystore.test.ts`（覆盖 `getOrCreate` 幂等、权限、回退、测试重置）。

---

## 七、验证总览

| 维度 | 结果 |
|---|---|
| 后端测试 | **203/203** 通过（含新增 `event-bus` / `keystore`；`git.test.ts` 加固为 repo 自适） |
| 后端 tsc | 0 错误 |
| 前端测试 | **124/124** 通过（含新增 `useAppStore` 4 用例） |
| 前端 tsc | 0 错误 |
| 双端 tsc | 0 错误 |

> 注：中等档基线为「后端 195 / 前端 120」；深度档在保持全绿的同时净增 `event-bus`、`keystore`、`useAppStore`、加固版 `git` 共 4 个测试文件。

---

## 八、风险与遗留

1. **`git.test.ts` 历史误假设**：原用例假设 `backend/` 非 git 仓库，因项目根 `git init` 后该前提永久失效。已改为按实际环境（`git rev-parse --is-inside-work-tree`）断言，repo 内外均绿——属测试加固，非逻辑回归。
2. **系统钥匙串待启用**：`@napi-rs/keyring` 未安装，`OsKeyStore` 当前回退 `FileKeyStore`；安装依赖后即自动升级为 OS keychain。
3. **中等档已知遗留（低危，未在本档处理）**：SkillsPanel try/finally 无 catch、SkillsPanel/LLMFlameChart `apiFetch` 裸 `/api` 路径、McpPanel 白名单 UI 硬编码中文、审批开关双入口（GeneralSection/ModelManager）、client 拦截器/SSE 无直接单测、SSE 401 无提示。
