# PRD：中等投入档 5 项改造（增量 PRD）

> 产品经理：许清楚（Alice） · 日期：2026-08-25
> 关联文档：[ARCH_REVIEW.md](./ARCH_REVIEW.md)（高见远架构评审）
> 语言：中文
> 测试基线：前端 113 用例 / 后端 154 用例 / 双端 tsc 0 错误（快速档交付后）

## 0. 背景与范围

本 PRD 是**增量 PRD**，仅描述相对当前基线（快速见效档已交付）的变更部分，不重述既有功能。范围取自架构评审"⚙️ 中等投入档"中的 5 项：

| # | 需求 | 评审编号 | 类型 |
|---|---|---|---|
| R1 | AgentChat.tsx / Settings.tsx 单文件拆分 | #1 #2 | 架构（纯重构） |
| R2 | 全局记忆检索 FTS5 化 + 预筛 + TTL 缓存 | #11 | 性能 |
| R3 | 日志链路统一 requestId + 错误脱敏 | #27 | 可观测性 |
| R4 | 审批全局开关安全加固（持久化 + 二次确认 + 审计） | #18 | 安全 |
| R5 | MCP 工具白名单 + 危险工具不可豁免审批 | #22 | 安全 |

每项均给出：产品目标 / 用户故事 / 需求池（P0/P1/P2）/ 验收标准 / 非目标 / 待确认问题。

---

## R1. AgentChat.tsx / Settings.tsx 单文件拆分（纯重构）

### 1.1 产品目标

在不改变任何用户可见行为与 UI 的前提下，将 AgentChat.tsx（987 行）与 Settings.tsx（1146 行）按职责拆分为独立组件文件，使后续迭代可独立维护、单测聚焦，消除"改一个面板牵动整页"的风险。

### 1.2 用户故事

- 作为**前端工程师**，我想把 AgentChat 中的消息流、工具审批卡、搜索、轨迹、文件追踪拆成独立组件，以便单个面板的改动不需要通读 987 行且不影响其他面板。
- 作为**前端工程师**，我想把 Settings 的六个分区（theme/language/general/knowledge/prompts/shortcuts）拆成独立组件，以便 15+ 受控字段不再堆在顶层、各分区可独立测试。
- 作为**QA**，我想在拆分后看到与拆分前完全一致的 UI 结构和行为，以便确认零回归。

### 1.3 需求池

| 优先级 | 需求 | 说明 |
|---|---|---|
| P0 | AgentChat 拆分为 ChatHeader / ChatMessageList / MessageRow(memo) / ChatInput / ToolApprovalCard 等独立文件 | 按评审 #1 建议方向；导出签名（`AgentChat` 组件对外接口）保持不变，App.tsx 引用不动 |
| P0 | Settings 按分区拆分独立组件文件（ThemeSection / LanguageSection / GeneralSection / KnowledgeSection / PromptsSection / ShortcutsSection） | 按评审 #2；`Settings` 组件对外接口（`onBack`）保持不变 |
| P0 | 拆分后前端全部测试通过、行为与 UI 逐项对照无回归 | 重构完成判定标准 |
| P1 | 共享纯逻辑（格式化、审批状态类型、搜索逻辑）抽取到独立 hooks/utils，减少跨组件 props 透传 | 仅在拆分过程中顺带提取，不引入状态管理库 |
| P1 | 新增对各子组件的单元测试（如 MessageRow 渲染、ToolApprovalCard 交互） | 提升子组件可测性 |
| P2 | 顺手为高频重渲染的 MessageRow 增加 memo 与时间缓存（衔接评审 #10） | 可选性能红利，非本项强制 |

### 1.4 验收标准

- AC-R1-1（行为不变）：拆分后，AgentChat 与 Settings 的全部用户操作路径（发消息/审批/搜索/轨迹/文件追踪/TTS/六个设置分区增删改查）在手动冒烟中与拆分前行为一致；前端测试套件全绿（当前 113 用例）。
- AC-R1-2（无回归）：双端 `tsc` 0 错误；`git diff` 中除组件文件移动/拆分外，无业务逻辑改动（允许等价改写）。
- AC-R1-3（接口稳定）：`App.tsx` 对 `AgentChat` / `Settings` 的引用与 props 无变化；子组件导出命名清晰、目录结构合理（建议 `src/components/chat/`、`src/components/settings/` 子目录）。

### 1.5 非目标

- 不改变任何 UI 视觉样式、文案、布局、交互流程。
- 不引入状态管理库（zustand/redux 等）、不引入新的依赖。
- 不做功能增强（不在本项内新增搜索、审批等新能力）。
- 不顺手重构与拆分无关的其它大文件（如 routes/agent.ts 属评审 #8，不在本项）。

### 1.6 待确认问题

- Q-R1-1：子组件目录组织偏好：`src/components/chat/*` 与 `src/components/settings/*` 子目录，还是平铺 `ChatHeader.tsx` 等？建议子目录，待架构师确认。
- Q-R1-2：拆分过程中是否允许对既有低质量代码做最小等价改写（如重复 JSX 提取变量）？建议允许但须逐行 review，避免隐性行为变化。

---

## R2. 全局记忆检索 FTS5 化 + LIMIT 预筛 + TTL 缓存

### 2.1 产品目标

将每轮 LLM 前的全局记忆检索从"SQLite 全表扫描 + 内存 O(N) 打分"升级为"FTS5 索引预筛 + 精排打分 + TTL 缓存"，在保持检索质量不下降的前提下显著降低检索延迟与 CPU 占用，支持记忆库增长到数万条仍流畅。

### 2.2 用户故事

- 作为**使用全局记忆的终端用户**，我想让记忆检索在记忆条数增多后依然快速，以便每轮对话不因检索拖慢响应。
- 作为**后端工程师**，我想用 FTS5 预筛出候选集（如 LIMIT 100）再走既有打分精排，以便去掉全表扫描、同时保留现有中文检索效果（FTS5 默认分词对中文不友好，需保留应用层精排）。
- 作为**后端工程师**，我想给检索结果加 TTL 缓存，以便同一会话短时间内重复检索（每轮 LLM 前）不重复全量计算。

### 2.3 需求池

| 优先级 | 需求 | 说明 |
|---|---|---|
| P0 | 为 `global_memories` 建立 FTS5 全文索引表（content + tags），写入/更新/删除时同步维护（应用层双写或触发器） | 涉及 `backend/src/db/schema.ts`、`memory/local.ts` |
| P0 | `localMemoryProvider.search()` 改为：FTS5 检索预筛候选（LIMIT 预筛，如 100 条）→ 复用现有 tokenize + score 精排 → 返回 topK | 保留现有中文/标签加权评分逻辑，保证质量不回退 |
| P0 | 检索结果 TTL 缓存（默认如 60s），记忆增删改时使缓存失效 | 避免脏读 |
| P0 | 后端测试全绿（现有 154 用例）+ 新增记忆检索相关单测 | 覆盖预筛召回、缓存命中/失效 |
| P1 | FTS5 索引可重建（admin 端点或启动时自愈），schema 迁移对存量数据兼容（首次启动自动建索引并回填） | 存量记忆库平滑升级 |
| P1 | 缓存命中率/检索耗时指标（简单计数日志即可，衔接 R3 日志） | 可观测性 |
| P2 | 检索质量对比测试（旧逻辑 vs 新逻辑 topK 召回对比） | 数据驱动验证不降质 |

### 2.4 验收标准

- AC-R2-1（不再全表扫描）：`search()` 的 SQL 不再出现 `SELECT * FROM global_memories` 全表读取；通过 FTS5 MATCH 预筛后再精排。
- AC-R2-2（行为兼容）：对同一查询，新检索结果 topK 与旧逻辑的**语义等价**（允许排序微调，但召回内容不应明显变差；用现有记忆样例断言关键命中仍在 topK）。
- AC-R2-3（性能与缓存）：记忆条数 ≥ 1000 时检索耗时不随总量线性增长；TTL 内重复检索命中缓存（第二次不重复执行打分）；记忆新增/删除后缓存正确失效，读到的不是旧数据。
- AC-R2-4（回归）：后端 154 用例全绿、`tsc` 0 错误；含中文与英文混合查询用例。

### 2.5 非目标

- 不引入向量 embedding / 向量数据库（sqlite-vec 已有但属 knowledge 域，记忆检索保持轻量全文检索）。
- 不改变 `MemoryEntry` / `MemoryProvider` 接口与 `registry.ts` 跨源合并逻辑。
- 不做前端 UI 变更（MemoryPanel 无改动）。

### 2.6 待确认问题

- Q-R2-1：FTS5 tokenizer 选型：默认 `unicode61` 对中文按整句切分，会明显影响预筛召回。建议**预筛用 FTS5（英文/标签召回）+ 应用层中文精排兜底**，或评估 SQLite `trigram` tokenizer（对中文子串匹配友好但索引更大）。需架构师技术确认。
- Q-R2-2：TTL 缓存时长默认值（建议 60s）与是否需要在设置中暴露？建议暂不暴露，硬编码常量即可。

---

## R3. 日志链路统一 requestId + 错误脱敏

### 3.1 产品目标

让每个后端请求从进入到响应都携带唯一 requestId，所有日志（含错误日志）统一走 logger 并带 requestId，错误信息统一脱敏，使线上问题能按请求串起完整调用链、避免敏感信息落盘。

### 3.2 用户故事

- 作为**后端工程师/运维**，我想在每个请求的日志里看到同一个 requestId，以便跨中间件/路由/工具调用追踪一次请求的完整链路。
- 作为**前端工程师**，我想在 API 响应头拿到 `X-Request-Id`，以便把前端报错与后端日志关联（复制 requestId 反馈问题）。
- 作为**安全工程师**，我想确保日志与错误信息不泄露 API Key / token / 长密钥，以便满足敏感信息不出日志的安全要求。

### 3.3 需求池

| 优先级 | 需求 | 说明 |
|---|---|---|
| P0 | 新增 requestId 中间件：每请求生成 UUID，注入 `req`/日志上下文，写入响应头 `X-Request-Id` | 挂在所有 `/api/*` 路由之前 |
| P0 | logger 支持 requestId 上下文（AsyncLocalStorage 或显式传参），日志行输出 requestId | `backend/src/utils/logger.ts` 改造 |
| P0 | 收敛后端 `console.log/error/warn` 直接调用，统一走 logger（现有 12 处 console + 4 处 logger 混用） | 保持输出格式兼容，不引入重型日志库 |
| P0 | 错误日志统一走 `logError`/`safeErrorMessage` 脱敏（复用 `error-mask.ts`），错误响应体同样脱敏 | 覆盖中间件与路由错误处理 |
| P1 | 请求入口/出口日志（method path status duration requestId），按需开关（LOG_REQUESTS 环境变量） | 默认 info 级别可开可关 |
| P1 | 前端 API client 记录/展示 `X-Request-Id`（如失败提示附带 requestId） | 前端仅小改 |
| P2 | 日志格式 JSON 化（可选开关），便于采集 | 非强制 |

### 3.4 验收标准

- AC-R3-1（链路贯穿）：同一请求在中间件、路由处理、工具执行、错误处理中输出的日志均包含**同一个 requestId**；响应头返回 `X-Request-Id` 且与日志一致。
- AC-R3-2（脱敏）：构造含 `api_key=sk-xxx`、`Bearer token`、32+ 位密钥的错误场景，日志与错误响应中不出现明文密钥（以 `***` 掩码）。
- AC-R3-3（收敛）：`backend/src` 下无新增裸 `console.*` 调用（允许 logger 内部保留）；既有 console 调用全部替换或显式豁免说明。
- AC-R3-4（回归）：后端 154 用例全绿、`tsc` 0 错误；健康检查等免鉴权路由同样有 requestId。

### 3.5 非目标

- 不引入第三方日志框架（winston/pino 等），保持轻量。
- 不做日志文件轮转、集中采集、告警（属后续运维建设）。
- 不改变日志输出目标（stdout/stderr）与现有 `LOG_LEVEL` 语义。

### 3.6 待确认问题

- Q-R3-1：requestId 传递方式：AsyncLocalStorage（推荐，业务代码无感）vs 显式参数贯穿。建议 AsyncLocalStorage，需架构师确认 Node 版本兼容（Node 18+ 支持）。
- Q-R3-2：是否需要在前端把 requestId 展示给用户（如错误弹窗显示"请求 ID：xxx"）？建议 P1 最小实现（控制台/错误提示附带），不做 UI 改版。

---

## R4. 审批全局开关安全加固（持久化 + 二次确认 + 审计）

### 4.1 产品目标

把"审批全局开关"从**无鉴权可改的内存变量**升级为**持久化 + 鉴权保护 + 二次确认 + 审计留痕**的安全配置，杜绝任意请求静默关闭审批、且重启后开关状态丢失的问题。

### 4.2 用户故事

- 作为**安全工程师**，我想让 `POST /api/agent/settings/approval` 在无鉴权时返回 401/403，以便审批开关不能被未授权请求关闭。
- 作为**管理员**，我想在关闭审批时看到明确的二次确认（前端对话框 + 后端 confirm 参数），以便防止误操作把危险工具变成免审批。
- 作为**审计人员**，我想在 `audit_logs` 中看到谁在何时把审批开关改成了什么，以便事后追溯。
- 作为**用户**，我想让审批开关设置重启后端后依然生效，以便不必每次重新配置。

### 4.3 需求池

| 优先级 | 需求 | 说明 |
|---|---|---|
| P0 | 审批开关持久化存储（SQLite 新表 `app_settings` 或复用现有存储），启动时从持久层加载，替代 `registry.ts` L118 内存变量 `let approvalRequired = true` | 重启不丢配置 |
| P0 | `POST /api/agent/settings/approval` 变更审批开关时：① 需鉴权（启用 AGENT_API_KEY 环境下无鉴权必须失败）；② 关闭（enabled=false）时需二次确认参数（如 `{ enabled: false, confirm: true }`），缺省拒绝；③ 写审计日志 | agent.ts L206 改造 |
| P0 | 新增审计：审批开关变更事件写入 `audit_logs`（event_type=`approval_toggle`，记录新值、请求方标识、时间） | 复用现有 `audit_logs` 表与 logAudit 模式 |
| P1 | 前端 Settings/AgentChat 关闭审批时增加确认对话框（提示"关闭后将不再要求工具审批"） | 前端小改 |
| P1 | 鉴权未启用（无 AGENT_API_KEY）时，本接口仍要求显式二次确认 + 审计（双保险） | 覆盖"裸奔"场景的最低防线 |
| P2 | 提供查询审计记录的入口（如 GET /api/agent/settings/approval/audit） | 可选 |

### 4.4 验收标准

- AC-R4-1（无鉴权必须失败）：在启用 `AGENT_API_KEY` 的环境下，不带鉴权调用 `POST /api/agent/settings/approval` 返回 401/403，且审批开关值不变。
- AC-R4-2（二次确认）：`POST { enabled: false }` 不带 `confirm: true` 时返回 400 且开关不变；带确认后成功切换，响应返回新状态。
- AC-R4-3（审计留痕）：每次成功变更审批开关，`audit_logs` 新增一条 `approval_toggle` 记录（含新值/请求方/时间）；无鉴权失败尝试也应记录（可选但建议）。
- AC-R4-4（持久化）：切换开关后重启后端进程，`GET /api/agent/settings/approval` 返回重启前的值。
- AC-R4-5（回归）：后端 154 用例全绿、`tsc` 0 错误；既有工具审批流程（executeTool 审批门）行为不变。

### 4.5 非目标

- 不实现完整的用户体系 / RBAC（本项只保证"鉴权+二次确认+审计"，权限模型后续再说）。
- 不改变审批流程本身（approval key / TTL / approve-deny 端点语义不变）。
- 不把"默认生成随机 key（评审 #23）"纳入本项实施——但见 Q-R4-1，若主理人希望"无鉴权必须失败"在默认环境也成立，则需把 #23 或等效默认鉴权作为前置依赖一并排期。

### 4.6 待确认问题

- Q-R4-1（关键）：当前后端鉴权是**可选**的（未设置 `AGENT_API_KEY` 时 authMiddleware 直接放行，见 server.ts）。"无鉴权请求必须失败"的断言只在启用鉴权环境成立。是否需要把"默认生成随机 key（评审 #23）"纳入本批实施作为前置依赖，使默认环境也满足该断言？请主理人决策。
- Q-R4-2：审批开关持久化放 SQLite 新表 `app_settings(key,value)` 还是复用 JSON 文件（如 mcp_servers.json 同目录）？建议 SQLite，与现有 DB 一致。

---

## R5. MCP 工具白名单 + 危险工具不可豁免审批

### 5.1 产品目标

把"MCP 服务器连接后工具全量暴露给 LLM"改为**按白名单暴露**，并确保文件写、shell 执行类危险工具即使审批全局关闭也**必须走审批**，收窄 MCP 插件的攻击面。

### 5.2 用户故事

- 作为**管理员**，我想为每个 MCP 服务器配置允许暴露的工具白名单，以便只把可信工具开放给 LLM，其他工具即使服务器已连接也不可见。
- 作为**安全工程师**，我想让危险 MCP 工具（写文件、执行命令类）不能被"关闭审批"豁免，以便危险操作始终有人工确认。
- 作为**开发者/使用者**，我想在 MCP 面板看到哪些工具被白名单放行、哪些被拦截，以便理解为什么某个工具不可用。

### 5.3 需求池

| 优先级 | 需求 | 说明 |
|---|---|---|
| P0 | MCP 服务器配置增加 `allowedTools?: string[]`（mcp_servers.json / store.ts），`connect()` 仅注册白名单内的工具；白名单为空时默认不暴露该服务器任何工具（fail-closed） | `mcp/manager.ts` 改造 |
| P0 | 危险工具识别规则：按名称/描述模式判定（文件写：write/save/create/append/delete/remove/edit；shell：exec/run/command/shell/terminal/bash 等），命中则 `requiresApproval` 强制为 true | 新增危险工具判定模块（放 `tools/` 或 `mcp/`） |
| P0 | `executeTool` 审批门改造：危险工具**不可豁免**——即使全局 `approvalRequired=false` 仍必须审批（需要区分"全局审批开关"与"危险工具强制审批"两层） | `tools/registry.ts` 改造 |
| P0 | 后端测试全绿 + 新增白名单与危险工具单测 | 覆盖：白名单外工具不可执行、危险工具不可豁免、无白名单默认不暴露 |
| P1 | 前端 MCP 面板：展示每个服务器的工具列表，支持勾选白名单（读写 mcp_servers.json 的 allowedTools）；展示被拦截/强制审批标记 | McpPanel 小改 |
| P1 | MCP 路由提供 `GET /api/mcp/:id/tools` 增强：返回每个工具是否白名单放行、是否危险、是否强制审批 | 面板数据源 |
| P2 | 危险工具规则可配置（内置默认 + 用户覆盖） | 可选 |

### 5.4 验收标准

- AC-R5-1（白名单生效）：配置 `allowedTools: ["mcp__server__read_only_tool"]` 后，仅该工具可被 `executeTool` 执行；白名单外工具返回 `TOOL_NOT_FOUND`/`MCP_TOOL_NOT_ALLOWED`，且不出现在 LLM 可见 schema 中。
- AC-R5-2（fail-closed）：未配置 `allowedTools` 的服务器连接后**不暴露任何工具**（工具列表为空），不给 LLM 提供任何 MCP 工具。
- AC-R5-3（危险不可豁免）：把全局审批开关关闭（`approvalRequired=false`）后，调用被识别为危险的 MCP 工具（如 `mcp__server__write_file`、`mcp__server__exec`）仍返回 `PENDING_APPROVAL`，必须经审批端点通过后才能执行。
- AC-R5-4（回归）：后端 154 用例全绿、`tsc` 0 错误；既有非 MCP 内置工具（memory 等）审批行为不变。

### 5.5 非目标

- 不做 MCP 服务器级整体鉴权（服务器凭据/密钥管理属后续）。
- 不改变 MCP 协议连接机制（stdio/sse/http 传输不变）。
- 不做前端整体 UI 改版（仅 McpPanel 增量配置入口）。
- 不自动清理历史残留的 mcp_servers.json 条目（评审遗留待决策项②，不在本项）。

### 5.6 待确认问题

- Q-R5-1：fail-closed（默认不暴露）可能影响现有用户——已有 6 条历史 MCP 服务器配置（mcp_servers.json）都未配白名单。迁移策略：① 全量 fail-closed，用户需手动配置（安全优先，推荐）；② 存量服务器迁移时默认全量放行并打警告，新服务器 fail-closed（兼容优先）。建议 ①，请主理人决策。
- Q-R5-2：危险工具判定的误伤风险：名称启发式可能误判（如名为 `save_settings` 的读操作工具）。是否接受"宁可多审批、不可少审批"的策略？建议接受，并允许用户在面板对单个工具标记"强制审批/仅审批"覆盖。

---

## 6. 跨项依赖与整体约束

- R2 涉及 `backend/src/db/schema.ts` 建表/索引迁移；R4 若同样落 SQLite 新表，需与 R2 的 schema 迁移机制统一（建议抽公共 migration 入口）。
- R3 的 requestId 中间件应挂在所有路由之前，R4/R5 的安全断言日志（审计）可与 R3 日志链路联动（审计记录可带 requestId）。
- R4/R5 均为安全项，评审遗留的"危险命令 deny 列表（terminal 无审批）"（遗留待决策①）与本批 R5 危险工具判定有概念重叠，建议实施时一并对齐判定规则，但**不扩大实施范围**。
- 整体不引入新依赖（除非架构师在 Q-R2-1/Q-R3-1 中确认必要且可控）。

## 7. 附：P0 判定理由摘要（回传主理人用）

| 需求 | P0 核心 | 判定理由 |
|---|---|---|
| R1 | 拆文件且行为不变 + 测试全绿 | 架构债直接影响后续所有前端迭代速度；纯重构无新风险，P0 拆分为硬性交付，P1/P2 是附带增强 |
| R2 | FTS5 预筛 + TTL 缓存 + 测试全绿 | 全表扫描是每轮 LLM 前的固定开销，随记忆增长线性劣化，属性能瓶颈；缓存与失效是正确性保障 |
| R3 | requestId 贯穿 + 脱敏 + console 收敛 | 无 requestId 时排障靠猜；错误不脱敏有敏感信息泄露风险；三者互为整体，缺一不可 |
| R4 | 持久化 + 鉴权 + 二次确认 + 审计 | 当前开关可被任意请求静默关闭且重启丢失，属明确安全漏洞；四项缺一不可 |
| R5 | 白名单 fail-closed + 危险工具不可豁免 | MCP 全量暴露是现实攻击面，危险工具可被"关审批"绕过是直接权限提升路径；fail-closed 是安全默认 |

---

*（本文档为增量 PRD，供架构师拆解设计与工程师实施使用；待确认问题需主理人/架构师拍板后更新。）*
