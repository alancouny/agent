# LLM 调用追踪与瀑布图 — 架构设计

## 目标

展示一次用户请求中**所有层级** LLM 调用的先后顺序与依赖关系：
主 Agent 的多次调用（工具循环）、`delegate_task` 子 Agent 的调用、Workflow 中
supervisor/worker 节点的调用。每条调用记录耗时、token、触发的工具，形成可
回放、可悬停查看的瀑布图。

## 数据模型

```ts
interface LLMCallRecord {
  id: string;                 // uuid
  sessionId: string;
  agentKind: 'main' | 'delegate' | 'supervisor' | 'worker'; // 层级
  parentId: string | null;    // 依赖关系：谁触发了本调用（delegate 的父调用）
  model: string;
  startAt: number;            // epoch ms
  endAt: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turn: number; step: number; // 主循环迭代坐标
  toolNames: string[];        // 该调用触发的工具执行（依赖下游）
  failed: boolean;
  contentPreview: string;     // 输出前 120 字符（诊断用）
}
```

## 数据流

```
AgentCore.run() 每轮迭代
  ├─ llmTracer.begin({kind:'main', turn, step, model}) ──► id
  ├─ callLLM()（成功/失败/超时都在 finally 中 end）
  └─ 工具执行：ToolContext.llmCallId = id
        └─ delegate_task 工具 → DelegateOptions.parentCallId = id
              └─ 子 Agent 每次 LLM call：begin({kind:'delegate', parentId: id})
Workflow 节点（supervisor/worker）：AgentCore config.telemetry.agentKind 标记
```

- **tracer 为全局单例**（环形缓冲，容量 1000，防泄漏）；
- `AgentConfig.telemetry = { agentKind?, parentCallId?, tracer? }` 由路由层
  （/chat、/workflow、delegate）注入，AgentCore 无感知地埋点；
- 前端通过 `GET /api/telemetry/llm-calls?sessionId=` 拉取。

## 前端瀑布图（LLMFlameChart）

- 纯 SVG 自绘（沿用 Sparkline 的零依赖原则）；
- x 轴 = 相对最早 startAt 的时间，bar 宽度 ∝ durationMs；
- 行序：按 startAt；**层级缩进**：父调用包含子调用区间，父子同色系深浅；
- 着色按 agentKind：main 蓝 / delegate 紫 / supervisor 琥珀 / worker 青；
- 悬停 tooltip：模型、耗时、tokens、turn/step、工具名、内容预览；
- 3s 自动刷新 + 手动刷新 + 失败标红。

## 扩展点

- 新增层级（如子工作流）只需在构造 AgentCore 时指定 `telemetry.agentKind`；
- 需要持久化时把环形缓冲落库（字段已含全部统计信息）。

---

# 全局长期记忆 — 双来源架构

## 目标

Agent 拥有跨会话的长期记忆，且记忆可来自两个来源：
1. **内置（local）**：Agent 自带的全局长期记忆（SQLite + 检索 + 注入）；
2. **MCP 接入**：经 MCP 协议读取第三方笔记（Obsidian / Notion 等）的记忆数据。

两种来源**无缝集成与切换**：provider 抽象 + 多选激活 + 统一检索合并。

## Provider 接口（后端 src/memory/）

```ts
interface MemoryProvider {
  readonly id: string;                       // 'local' | 'mcp:obsidian'
  readonly kind: 'local' | 'mcp';
  readonly label: string;                    // 展示名
  isAvailable(): Promise<boolean>;           // local 恒真；MCP 取决于工具是否已注册
  list(limit?: number): Promise<MemoryEntry[]>;
  get(id: string): Promise<MemoryEntry | null>;
  add(entry: { content: string; tags?: string[] }): Promise<MemoryEntry>;
  update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry | null>;
  remove(id: string): Promise<boolean>;
  search(query: string, topK: number): Promise<MemoryEntry[]>;  // 统一检索
}
```

## 两个实现

**local.ts** — SQLite 表 `global_memories(id, content, tags, source, created_at, updated_at)`；
检索：关键词重叠评分（tokenize + 交集加权），轻量无 embedding 依赖。

**mcp.ts** — 适配器：在 toolRegistry 中发现 MCP 注册的"记忆类"工具
（工具名启发式匹配 `memory|note|obsidian|notion|brain|search` 等，规则可配置）：
- search → `executeTool(搜工具, {query})` 解析输出为 MemoryEntry 列表；
- 未发现对应工具时 `isAvailable() = false`，面板显示"未连接"。
- 工具名映射（searchTool / listTool / addTool / deleteTool）可通过
  `mcpMemoryToolMap` 显式配置，缺省启发式。

## 注册表与切换（registry.ts）

```ts
const providers = new Map<string, MemoryProvider>();
const activeIds = new Set<string>();        // 默认 ['local']
activate(id, on) / getActive() / searchAll(query, topK)  // 并发查所有 active，按 score 合并
```

- 切换语义：**多选**——local 常开，MCP 源可按需点亮；
- `searchAll` 把各源结果按 score 归并排序（无缝集成）；
- 新增来源 = 实现 MemoryProvider + register（灵活可扩展）。

## 注入与 Agent 使用

- **注入**：`AgentConfig.memory = { enabled, topK }`；run() 开始时
  `memoryService.searchAll(userPrompt, topK)` → 结果以
  `[LONG-TERM MEMORY]` 段追加到系统提示（仅读不写，防循环）。
- **Agent 主动读写**：注册两个工具 `memory_search` / `memory_save`
  （agent-meta-tools 同级），内部走 active provider —— 这就是
  "Agent 自带全局长期记忆功能"的接口：模型可检索、可沉淀。

## API（backend/src/routes/memory.ts）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/memory/providers | 列出全部源 + available + active |
| POST | /api/memory/providers/:id/activate | {active: bool} 切换激活 |
| GET | /api/memory/search?q=&topK= | 跨 active 源合并检索 |
| GET | /api/memory?provider= | 列表（默认 active 全部） |
| POST | /api/memory | 新增 |
| PATCH | /api/memory/:id | 更新 |
| DELETE | /api/memory/:id | 删除 |

## 前端 MemoryPanel

- Provider 卡片：local（常开）+ 每个 MCP 源（可点亮/关闭，显示 available）；
- 记忆列表 CRUD + 标签；搜索框（实时）；
- 「注入开关」：控制 agent 运行时是否注入记忆（localStorage 持久化，
  /chat 路由读取传入 config.memory）。

---

# 研究实验场 — 四个创新模块

## 1. Agent 元认知（预算预测与校准）
- `config.metacognition` 开启后，系统提示注入 COST_ESTIMATE 指令；
  首次响应经 `parseCostEstimate` 提取（JSON / "N calls, M tokens" 双格式）；
  run 结束 `saveCostEstimate` 落库（预测 vs 实测工具调用数/token）；
  `GET /api/metacog/estimates` 返回记录 + `calibrationBins`（预测分桶 vs 实际均值）。
- 意义：量化"模型是否知道自己该花多少计算"（ACS adaptive compute 的实证面）。

## 2. 经验回放（失败蒸馏教训库）
- AgentCore 收集失败（工具错误/死循环熔断/Max iterations）→ `recordLesson`
  写入长期记忆（source=local, tags=[lesson, replay]）；
  `GET /api/memory/lessons` 查询；注入时随普通记忆被检索复用（replay 机制实例化）。

## 3. 会话漂移雷达
- `hashEmbed`（64 维 char-bigram 哈希 + L2 归一，中文单字加权）——零依赖离线可用；
  每消息在线更新 centroid，漂移分数 = 1 - cosine(msg, centroid)；
  > 0.6 记漂移事件；agent 路由保存用户消息时自动 ingest。
- `GET /api/drift` / `POST /api/drift/ingest`。

## 4. 行为指纹图谱（实验台升级）
- 实验 run 聚合 fingerprint（工具使用分布 + 多样性），响应内联返回；
  ExperimentLab 新增 radar 视图：tokens/time/calls/tool-diversity/success
  五维归一化雷达，≥2 个成功 run 可对比"不同配置的行为长相"。

## 前端
- Tab 'metacog'（校准条 + 预测表 + 开关 localStorage `metacog_enabled`）；
- Tab 'drift'（指标卡 + 漂移折线 + 事件流）；
- MemoryPanel 增「lessons」教训折叠区；ExperimentLab 增 radar 视图切换。
