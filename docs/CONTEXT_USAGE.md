# 上下文窗口使用情况（实时流式展示）

> 功能：在聊天头部实时展示当前模型的**上下文窗口使用情况** —— 已用 tokens / 窗口容量 /
> 利用率百分比，并在 Agent 流式执行过程中以「加载中」的动画方式平滑增长。

---

## 1. 实现方案总览

```
┌────────────────────────────┐        SSE (text/event-stream)        ┌─────────────────────────────┐
│  backend (Express)         │  ───────────────────────────────────▶ │  frontend (React)           │
│                            │     data: {"type":"text","usage":{    │                             │
│  AgentCore.run()           │           promptTokens, completion..., │  AgentChat.handleSend       │
│    └─ callLLM() → usage    │           contextWindow}}              │    └─ streamAgentEvents()   │
│                            │                                       │    └─ useContextUsage()     │
│  usage_log (SQLite)        │  ◀── GET /api/agent/tokens?sessionId  │    └─ ContextUsageBar       │
│  model_provider catalog    │  ───────────────────────────────────▶ │       （进度条 + 详情）     │
└────────────────────────────┘   contextWindow 容量（按 provider/model）│                             │
                                                                     └─────────────────────────────┘
```

采用**推送为主、拉取兜底**的双通道设计：

1. **实时通道（推送）**：复用现有的 `/api/agent/chat`、`/api/workflow/run` SSE 流。Agent 每完成
   一次 LLM 调用（多步 Agent 会调用多次），`AgentCore` 就 yield 一个携带 `usage` 的 `text` 事件。
   前端在事件回调里实时更新进度条 —— 这就是「流式、加载式」的实时效果。
2. **恢复通道（拉取）**：会话恢复 / fork / 切会话时，调用已有的 `GET /api/agent/tokens` 拉取
   `usage_log` 表的会话累计用量，并用消息内容估算当前上下文占用。

## 2. 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 当前上下文 tokens（prompt + completion） | SSE `text` 事件的 `usage` 字段 | `AgentCore.callLLM()` 返回的 provider usage，已归一化为 camelCase |
| 模型窗口容量 contextWindow | ① `usage.contextWindow`（后端随事件下发）<br>② `GET /api/model/providers` 模型目录<br>③ 前端内置碎片表兜底 | 后端在 `routes/agent.ts`、`routes/workflow.ts` 构造 `AgentConfig` 时通过 `getModelContextWindow()` 从模型目录解析 |
| 会话累计用量 | `GET /api/agent/tokens?sessionId=` | `usage_log` 表按 session 的 `SUM(prompt_tokens/completion_tokens/total_tokens)` |
| 兜底估算 | 前端 `estimateTokens()` | 后端不返回 usage（部分本地/网关模型）时，按「CJK≈1 token/字，其他≈4 字符/token」估算 |

### 2.1 关键后端改动

- `backend/src/routes/model_provider.ts`：导出 `getModelContextWindow(providerId, modelId)`，
  从内置/自定义模型目录解析容量（单一数据源，前端不重复维护目录）。
- `backend/src/agent/types.ts`：`AgentConfig` 与 `AgentStreamEvent.usage` 增加 `contextWindow?`。
- `backend/src/routes/agent.ts`、`backend/src/routes/workflow.ts`：构造 config 时注入
  `contextWindow: getModelContextWindow(provider, model)`。
- `backend/src/agent/core.ts`：
  - `logUsage()` 兼容 snake_case / camelCase（修复了 OpenAI 等返回 `prompt_tokens` 的 provider
    之前**无法写入 usage_log** 的问题，`/agent/tokens` 因此才有真实累计数据）；
  - yield `text` 事件时归一化为 `{ promptTokens, completionTokens, totalTokens, contextWindow }`。

## 3. 计算方式

```ts
contextUsed   = promptTokens + completionTokens        // 最近一次 LLM 调用实际消耗
              ≈ totalTokens（provider 直接给出的总数）
percent       = min(100, contextUsed / contextWindow × 100)
cumulative    = usage_log 按 session 汇总：SUM(total_tokens) 等
```

要点：

- **多步 Agent**（工具调用链）每次 `callLLM` 都会把完整历史重新发给模型，因此每步的
  `promptTokens` 随对话增长，进度条自然呈现「越聊越满」的实时增长。
- **颜色分级**：<50% 绿（正常）、50–80% 黄（注意）、≥80% 红（接近上限，提示应清空/换模型）。
- **来源标记**：`live`（流式真实数据） / `restored`（恢复估算） / `estimated` / `none`，
  详情面板中可见，避免误导用户。

## 4. 前端集成（展示 + 流式更新）

### 4.1 新增文件

- `src/hooks/useContextUsage.ts` —— 状态逻辑：
  - `consumeUsage(event.usage)`：流式事件回调中调用，实时更新 `contextUsed/percent`；
  - `setModel(provider, model)`：异步解析窗口容量（目录 → 碎片表 → 默认 128k）；
  - `restore(sessionId, messages)`：恢复累计用量 + 估算当前上下文；
  - `reset()`：新会话归零（保留已知容量）。
- `src/components/ContextUsageBar.tsx` —— 展示组件：
  - 常驻聊天头部：`12.4k/128.0k` + 进度条 + `9.7%`；
  - 流式时进度条 `transition-all duration-500` 平滑增长 + `animate-pulse` 脉冲 + 呼吸圆点；
  - 点击展开详情：输入/输出 tokens、窗口容量、会话累计、数据来源；
  - 窄屏 `hidden lg:block` 自动隐藏，不挤占头部按钮。

### 4.2 改动文件

- `src/types/index.ts`：`usage` 类型增加 `contextWindow?`；新增 `ContextUsage` 接口。
- `src/components/AgentChat.tsx`：
  - 头部渲染 `<ContextUsageBar usage={ctxUsage} model={selectedModel} streaming={isLoading} />`；
  - `handleSend` 开头 `ctxReset()` + `ctxSetModel(provider, selectedModel)`；
  - SSE `text` 事件里 `consumeUsage(event.usage)` —— **这是流式实时更新的接入点**，
    与既有 `streamAgentEvents` 完全兼容，无需改动 API 层；
  - `useEffect([sessionId])` 会话变化时 `ctxRestore()`（覆盖恢复 / fork / 首条消息建会话）；
  - `handleClear` 时 `ctxReset()`。

### 4.3 行为时序

```
发送消息 → reset + 解析窗口容量（异步） → 流开始（bar 显示 "…" 脉冲）
  ├─ text 事件带 usage → 进度条增长（多步 Agent 逐步增长）
  ├─ text 事件无 usage（本地模型）→ 保持估算/空态
  └─ done → streaming=false，bar 定格；累计用量经 /agent/tokens 刷新
```

## 5. 已知限制与后续增强

- **Workflow（supervisor/delegate）模式**：delegate 节点的 `text` 事件目前不携带 `usage`，
  该模式下进度条不实时增长（仅恢复/估算）。可选增强：`delegateTask()` 返回值透传 usage。
- **估算精度**：字符级估算仅用于兜底，与真实 tokenizer 有偏差；`live` 数据到达后即覆盖。
- **窗口容量未知**（自定义 provider 未登记模型）：bar 显示 `?` 容量，仅展示已用 tokens。

## 6. 验证

- `npm run test:ui`：新增 `useContextUsage.test.tsx`（8 例）、`ContextUsageBar.test.tsx`（5 例），
  全套 44 例通过。
- `npx tsc -b` 与 `npx vite build` 通过；新增文件 ESLint 无告警。
