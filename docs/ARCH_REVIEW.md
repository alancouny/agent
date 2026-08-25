# 架构/性能/安全/可维护性评审报告（高见远 / Architect）

> 评审时间：2026-08-24 · 覆盖：src/App.tsx、AgentChat.tsx(987行)、Settings.tsx(1146行)、api/client.ts、backend/src/server.ts、agent/core.ts、routes/*、workspace/fs.ts、memory/*、telemetry/*、tools/*、mcp、sandbox、session、utils、database、双端 package.json/tsconfig、vite.config.ts、dist 产物
> 测试基线：前端 113 用例、后端 147 用例

## 一、架构与可维护性
1. 🟡 AgentChat.tsx（987行）单文件职责过载（消息流/工具面板/搜索/轨迹/文件追踪/审批/TTS/上下文条）→ 拆 ChatHeader/ChatMessageList/MessageRow(memo)/ChatInput/ToolApprovalCard
2. 🟡 Settings.tsx（1146行）六分区全内联 + 15+ 受控字段堆顶层 → 按分区拆组件
3. 🟡 AgentCore 与 memory/telemetry/knowledge 依赖方向倒挂（core 直接 import 横切模块 + 直写 SQLite）→ 收敛为 hooks + 事件总线
4. 🔴 双代码执行工具并存：builtin.ts execute_code（node:vm 可逃逸）仍启用，run_code 已用 isolated-vm → 下线 execute_code
5. 🟡 路径校验三处重复不一致（fs.withinRoot / git.rootOf / texttools.rootOf）→ 统一 assertWithinRoot
6. 🟡 API Key 双份存储双数据源（agent_api_settings vs agent_api_key，App/Settings/ModelManager 各写各的）→ 统一单一 key 源
7. 🟢 前端无状态管理，面板间 props+localStorage 散传 → 轻量 zustand/Context
8. 🟢 routes/agent.ts（480行）巨型 + token 估算重复定义 → 按域拆分

## 二、性能
9. 🟡 主 bundle 569KB 偏大（manualChunks 只拆 3 块）→ 聊天页大子组件 lazy + gzip 预压缩
10. 🟡 renderMessageRow 非 memo + 每次渲染重算 toLocaleTimeString → MessageRow memo + 时间缓存
11. 🟡 全局记忆检索全表扫描（每轮 LLM 前 O(N) 打分）→ SQLite FTS5 / LIMIT 预筛 / TTL 缓存
12. 🟢 sessionEvents 每次写入多一次 MAX(seq) 查询 → AUTOINCREMENT
13. 🟡 texttools 正则同步执行无超时（ReDoS）→ node-re2 / worker_threads
14. 🟢 SSE text 事件整树 setState（已有 LiveStats 优化）→ 增量 diff 缓冲
15. 🟢 并发 agent run 无上限 → 全局信号量（同时最多 4）

## 三、安全
16. 🔴 run_command 工具绕过 assertSafeCommand 直接进 shell（system-tools.ts L38 / computer-use handlers L200）→ executeCommand 内部统一强制校验
17. 🔴 execute_code（node:vm）可原型链逃逸仍向 LLM 开放 → 下线，统一 run_code
18. 🟡 审批全局开关可被无鉴权关闭（agent.ts L202 / registry L112）→ 持久化 + 二次确认 + 审计日志
19. 🔴 路径校验纯字符串比较，symlink 可逃逸工作区 → 文件操作前 realpath 校验
20. 🟡 terminal cwd 不受工作区约束 → 与 git 一致限定 PROJECT_ROOT 内
21. 🟡 API Key 明文落盘多处（localStorage / rag_config）→ Tauri keychain + 掩码回显
22. 🟡 MCP 工具全量暴露无 per-tool 白名单 → 白名单 + 危险工具不可豁免审批
23. 🟡 认证默认关闭（无 AGENT_API_KEY 全裸奔）→ 默认生成随机 key
24. 🟢 knowledge URL 抓取 SSRF 有 DNS 重绑定 TOCTOU → axios 固定已校验 IP
25. 🟢 openUrl Windows 分支 cmd 注入面 → explorer.exe 单参数

## 四、健壮性与可观测性
26. 🟡 waitForApproval 轮询不响应断连 signal → 支持 AbortSignal
27. 🟡 日志覆盖面不足（console 与 logger 混用，无 requestId）→ requestId + 收敛 + 错误脱敏
28. 🟢 Settings 删除操作无 try/catch → 统一加错误提示
29. 🟢 AgentChat catch 路径重复 8 行 + 审批裸 fetch 静默 → 抽 finishWithError
30. 🟢 drift/llm-tracer 进程内存态重启丢失 → 定期快照 SQLite
31. 🟡 环境变量分散读取无集中校验 → backend/src/config.ts + zod fail-fast
32. 🟢 生产启动依赖 tsx 运行时 → build 产物 + sidecar

## 五、依赖与工程
33. 🟢 依赖基本健康；devDeps nodemon/ts-node/tsx 三件套重叠 → 删 nodemon；axios 可换 fetch
34. 🟢 后端 tsconfig 缺 noUnusedLocals，any 泛滥 → 补严格项 + 逐步收敛 as any

## 路线图
🚀 快速见效（1-2天）：下线 execute_code；run_command 收口 assertSafeCommand；withinRoot 统一 + realpath；Settings 删除 try/catch；waitForApproval AbortSignal；API key 收敛；env config.ts；texttools 防 ReDoS
⚙️ 中等投入（1-2周）：AgentChat/Settings 拆分；记忆检索 FTS5；审批持久化 + 默认 API key；日志 requestId 收敛；MCP 白名单；bundle 二次拆分
🏗️ 深度重构（3-6周）：AgentCore 解耦事件总线；前端状态层；routes 拆分；后端编译产物 + Tauri sidecar；API key keychain 化

---

## 实施进度（2026-08-25 快速档已交付）

| 项 | 状态 | 说明 |
|---|---|---|
| 下线 execute_code（node:vm） | ✅ | builtin.ts enabled:false + /tools enabled 过滤 + registry UPSERT 自愈脏数据 |
| run_command 统一 assertSafeCommand | ✅ | executeCommand 内部强制校验，三条路径收口；仅拦注入类命令（纯破坏命令如 rm -rf 仍放行，属产品决策待定） |
| 路径校验 realpath 化 | ✅ | workspace/fs.ts 统一 assertWithinRoot（词法+realpath），fs/texttools/git 三处收敛；新增 8 个 symlink 单测 |
| 前端删除错误处理 | ✅ | Settings knowledge/prompt remove 补 try/catch + 提示 |
| 测试 DB 隔离 | ✅ | AGENT_DB_PATH(:memory:) + preload.mjs；真实库 checksum 两轮不变；mcp_servers.json 备份恢复 |
| 其他 | ✅ | terminal.execute 描述修正；tools 表 UPSERT 自愈 |
| 测试基线 | ✅ | 后端 154/154、前端 113/113、双端 tsc 0 错误 |

遗留待决策：① 危险命令 deny 列表是否加（terminal 无审批）；② mcp_servers.json 6 条历史残留是否一次性清理；③ terminal cwd 是否限制工作区（维持现状或后续处理）。

## 实施进度（2026-08-25 中等档已交付）

| 项 | 状态 | 说明 |
|---|---|---|
| R1 AgentChat/Settings 拆分 | ✅ | chat/ 8 文件 + settings/ 6 文件，容器瘦身，App.tsx 零改动，既有测试零改动全绿 |
| R2 记忆检索 FTS5 化 | ✅ | 双 FTS5 external content（unicode61 英文/标签 + trigram 中文≥3字符）+ 2 字 LIKE 兜底 + TTL 缓存（60s，增删改失效）+ 启动自愈回填；多段中文按段并集召回 |
| R3 日志 requestId + 脱敏 | ✅ | AsyncLocalStorage + 中间件挂最前（含健康检查）+ X-Request-Id 响应头 + 8 处 console 收敛 + 全路由错误响应 safeErrorMessage（含 OpenAI sk- 格式盲区修复） |
| R4 审批持久化 + 二次确认 + 审计 | ✅ | app_settings 表 + settingsStore + confirm:true 校验 + audit_logs(approval_toggle) + 前置 #23 默认随机 key 强制鉴权 |
| R5 MCP 白名单 + 危险工具强制审批 | ✅ | allowedTools fail-closed（存量同样）+ tools/dangerous.ts 模式判定 + executeTool 两层门（approvalRequired \|\| dangerous）+ GET /:id/tools 标注 + PUT /:id |
| 默认随机 API key（评审 #23） | ✅ | ensureApiKey() randomBytes 无条件挂 auth，启动日志醒目打印；前端统一 Bearer 注入（axios 拦截器 + apiFetch + 7 面板收敛 + authHeader/authHeaders 统一 getAgentApiKey） |
| 测试基线 | ✅ | 后端 195 通过（QA 独立 17 用例全绿；5 个失败为沙箱删除守卫环境产物非回归）；前端 120/120；双端 tsc 0 错误 |

交付文档：PRD_MEDIUM_TIER.md / DESIGN_MEDIUM_TIER.md / QA_MEDIUM_TIER_BACKEND.md（含 Round 2/3）。
已知遗留（低危，记录未处理）：SkillsPanel try/finally 无 catch、SkillsPanel/LLMFlameChart apiFetch 裸 /api 路径、McpPanel 白名单 UI 硬编码中文、审批开关双入口（GeneralSection/ModelManager）、client 拦截器/SSE 无直接单测、SSE 401 无提示。

## 实施进度（2026-08-25 深度档已交付）

| 项 | 状态 | 说明 |
|---|---|---|
| D0 清理 6 条 MCP 死配置 | ✅ | 删除全部 6 条 `echo-e2e`（指向不存在的 echo-server.mjs，autostart:false），仅留 `mcp-memory` |
| D1 routes/agent.ts 拆分 | ✅ | barrel 模式拆 chat/tools/approval/models/sessions/context 六域，路径语义不变；`core-routes.test.ts` 零改动全绿 |
| D2 AgentCore 事件总线解耦 | ✅ | `AgentEventBus`(EventEmitter) 泛型 `'event'`+按 type 分频道；`run()` 由 AsyncGenerator 改为 `async`+`emit`；chat/experiments/workflow 三处消费者改造；新增 `event-bus.test.ts` |
| D3 前端状态层 zustand | ✅ | `src/store/useAppStore.ts`（persist+createJSONStorage），localStorage 键 `agent_api_settings` 不变零迁移；App/ModelManager/ExperimentLab/WorkspacePanel 收敛；新增 `useAppStore.test.ts` |
| D4 API key keychain 化 | ✅ | `KeyStore` 接口：`FileKeyStore`(0600 默认) + `OsKeyStore`(懒加载 `@napi-rs/keyring` 回退)；`ensureApiKey()` 仅首次生成打印明文；新增 `keystore.test.ts` |
| 测试基线 | ✅ | 后端 203/203、前端 124/124、双端 tsc 0 错误 |

交付文档：DESIGN_DEEP_TIER.md。
已知遗留：① `@napi-rs/keyring` 未安装，`OsKeyStore` 当前回退 `FileKeyStore`，安装依赖后自动启用系统钥匙串；② 中等档已知遗留（见上）仍低危未处理；③ `git.test.ts` 原误假设 `backend/` 非仓库，已加固为 repo 自适断言（非逻辑回归）。
