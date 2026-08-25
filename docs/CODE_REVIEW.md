# ai-agent-app 全量代码审查报告

- **日期**：2026-08-22
- **范围**：前端 `src/`（51 文件）、后端 `backend/src/`（45 文件）、`src-tauri/`（Rust 壳）、构建/测试/文档配置
- **方法**：4 路并行模块审查 + 双端 `tsc` 实测 + 关键结论逐条人工复核

---

## 0. 结论速览（TL;DR）

1. **双端构建当前为红**：前端 `tsc -b` 报 65+ 错误（client.ts 类型未导入、App.tsx 缺 useLocalStorage、AgentChat.test.tsx 大量类型问题、`context_compressed` 事件未注册）；后端 `tsc --noEmit` 报 7+ 错误（voice.ts、server.ts:54、workspace/fs.ts:133、core.ts:314 等）。**任何优化都应先恢复绿灯。**
2. **存在 4 个 P0 级安全面**：无鉴权 shell 执行（terminal）、CORS/监听全开（CSRF + LAN 暴露）、Node vm 伪沙箱可逃逸、`read_file` 任意路径读取。
3. **5 个高收益低难度修复**：SSE AbortError 挂起、i18n `${}`→`{{}}`、axios baseURL 缺 `/api`、`/context/compress` 的 `id` 列漏查、React.lazy 代码分割。
4. 全项目约 70 条可执行优化点，按 P0→P3 分级，详见下文。

---

## 实施进度（2026-08-22 更新）

**✅ M1 安全止血（全部完成）**
- 后端监听改绑 `127.0.0.1`（`server.ts`，支持 `HOST` env）；CORS 白名单（`CORS_ORIGINS` env，覆盖 vite/tauri origin，非白名单 Origin 拒绝）
- 鉴权中间件修复：`res` 未定义引用、`Object.values(Set)` 前缀豁免失效两处 bug
- `workspace/fs.ts`：`?root=` 限制为配置工作区内部；补 `rm` 导入
- `tools/builtin.ts`：`read_file` 接入 workspace 路径校验（禁止任意绝对路径）；`execute_code` 沙箱遮蔽 `process/require/Buffer/globalThis` + 输出上限 + 描述改为"受限环境（需审批）"诚实标注；`weather` 补 8s 超时
- `model_provider.ts`：`GET /providers/:id`、`GET /current` 的 apiKey 掩码化，`POST /config` 掩码不回写
- `knowledge.ts`：`/ingest` 加 SSRF 防护（仅 http(s)、禁私网/环回/链路本地，DNS 解析校验）+ 文本 2MB 上限
- `mcp.ts`：stdio `command` 增加 shell 元字符/命令包装器校验
- `knowledge/store.ts`：`embed()` 补 8s 超时 + 单次重试（embedding 服务不可用时快速降级，不再挂死检索）

**✅ M2 构建绿灯（全部完成）**
- 双端 `tsc` 清零：后端 8 处（voice.ts listVoices、server.ts:54、fs.ts:133 rm、core.ts logEvent 传参、agent.ts compress 缺 id、builtin.ts peek 类型等）；前端 20+ 处（client.ts 类型导入、App.tsx useLocalStorage、types union 补 `context_compressed`、ContextUsageBar `compressed` prop、Settings voice 联合收窄、useTTS `SpeechSynthesisUtterance`、各组件未用声明清理）
- `/context/compress` 修复 SELECT 漏查 `id` 列（压缩此前从未真正删除旧消息）+ 事务批量删除
- `tsconfig.app.json` 排除 `__tests__`（构建与测试类型解耦）；删除根目录 `fix_test.py`
- 测试环境修复：`registry.test.ts` 设 `WORKSPACE_ROOT=/tmp`（写文件测试原会越权失败）；`embed()` 超时修复连带解决 `/search` 测试挂起（dev DB 中 rag_config 被污染为远程 embedding）

**验证**：前端 tsc ✅ / vite build ✅ / vitest **88/88** ✅；后端 tsc ✅ / node:test **56/56** ✅；冒烟：监听 127.0.0.1:3001、健康检查、apiKey 掩码、非白名单 Origin 拒绝 ✅

**✅ M3 流式链路 + i18n + 代码分割（全部完成）**
- SSE 前端边界（`client.ts`）：AbortError 不再挂起（reject 收尾，调用方已判 AbortError 静默）；跨 chunk 行缓冲（大事件不截断）；空闲超时兜底（读 `gen_timeout` 设置）；SSE 手动带 `Authorization` Bearer（与 axios 拦截器一致）；axios baseURL 统一 `/api` 前缀（修复 Tauri 端 REST 404）；`applyApiBase` 同时刷新超时
- SSE 后端断连取消：`/agent/chat`、`/workflow/run` 监听 `res.on('close')` → `AbortController` 注入 `AgentConfig.signal`，agent 在循环头部/callLLM 前检查并提前终止；断连后跳过落库与 done 写入；每 15s 写 `: ping` 心跳；`ollama.ts` 断连即销毁上游流
- LLM 超时：`openai/anthropic` SDK 全部补 `timeout: 60000`、`maxRetries: 0`（core.ts / delegate.ts / workflow nodes.ts）
- i18n：7 语言 63 处 `${var}` → `{{var}}`（i18next 插值修复）；补 en 缺失 8 键 + 各语言 104 个漂移键；新增 `keys.test.ts` 键对齐门禁（8 例，拦截翻译漂移）
- 代码分割：App.tsx 12 个非首屏面板改 `React.lazy` + Suspense（Settings/ModelManager 等独立 chunk，不进首屏）
- AgentChat 稳定性：卸载时 abort 流式请求；历史恢复改为 sessionId 驱动（覆盖 fork/新会话）+ 取消标志防竞态

**验证**：前端 tsc ✅ / vite build ✅（分块生效）/ vitest **96/96** ✅；后端 tsc ✅ / node:test **84/84** ✅；冒烟：SSE 心跳 `: ping` + error/done 收尾 ✅

**✅ P2/P3 剩余项（全部完成）**
- 渲染性能（A）：AgentChat 移除每 100ms 全树重渲染（`LiveStats`/`ElapsedBadge` 自 tick memo 子组件）；scrollIntoView 去 smooth；FileTrackerPanel `Math.random` → 路径哈希（确定性渲染）
- 后端正确性/性能（B）：context-compressor 改用下标定位压缩组（修复重复内容消息误删）；重试仅对 429/5xx/网络错误（`NonRetriableError`，401/400 立即失败）；审批 key 加 10 分钟 TTL；session_events 每 300 次写清理 30 天前事件；web_search 8s 超时 + 失败如实上报（去 mock 假结果）；消息落库/会话创建抽取 `session/messages.ts` 共享模块（消除 agent/workflow 三处重复）；`GET /:id/messages` 支持可选 `?limit=`
- 存储健壮性（C）：prompts/skills/mcp 三个 JSON store 原子写（temp+rename）+ 解析失败告警；skills 加内存缓存（每 turn 不再读盘）；AgentCore 历史消息构造期深拷贝
- 前端杂项（D）：Image/VideoGenerator 补传 `negative_prompt`；WorkspacePanel data URI 扩展名白名单 + API 基址惰性求值；TrajectoryDrawer 轮询取消 + steer 错误处理；RagHelp JSON 解析安全兜底；TasksPanel 轮询闭包修复；index.html 标题
- 后端杂项（E）：computer-use AppleScript 注入转义（x/y 数值校验、typeText/pressKey 完整转义）；image 真实失败改 503（不再 mock 掩盖）；voice /stt 大小上限 10MB；优雅停机回收 MCP/computer-use 子进程；`@types/express` 对齐 4.x（原 5 类型配 4 运行时）；build 脚本明确 `tsc --noEmit`；知识库 bruteforce 检索加解析后向量缓存（embedding 版本/文档数变化自动失效）

**验证**：前端 tsc ✅ / vite build ✅ / vitest **96/96** ✅；后端 tsc ✅ / node:test **84/84** ✅；冒烟 ✅

**有意保留（非缺陷）**：code.ts 的 mock 分析（明确标注"Mock Output"的诚实降级）；video.ts 纯占位实现（未接入真实视频 API 的产品占位）；无 API key 时 image/video 的本地占位预览。剩余可选深度项（依赖外部/重构成本高）：React Compiler 接入、消息列表虚拟化（@tanstack/react-virtual）、Tauri keyring 密钥托管、isolated-vm 真沙箱、Express 5 升级、Cargo edition 2024。

---

## 1. P0 —— 构建止血 + 安全面收敛（建议 1 天内）

### 1.1 修复双端编译错误
| 位置 | 问题 | 建议 | 难度 |
|---|---|---|---|
| `src/api/client.ts:355/363/463` | `CompareResult`/`TrajectoryEvent`/`DbMessage` 未从 types 导入，TS2304 | 补 `import type { ... }` | 低 |
| `src/App.tsx:27/38/44` | `DEFAULTS` 死代码；`useLocalStorage` 未导入 | 删除 DEFAULTS；`import { useLocalStorage } from './hooks/useLocalStorage'` | 低 |
| `src/types/index.ts:29` + `AgentChat.tsx:350` + `ContextUsageBar.tsx:50` | 后端已发 `context_compressed` 事件、组件已解构 `compressed` props，但前端事件 union 与 `ContextUsageBarProps` 均未声明 | 与 `backend/src/agent/types.ts` 对齐 union；props 补 `compressed?: boolean` | 低 |
| `tsconfig.app.json:28` | include `"src"` 把 `__tests__` 纳入构建，测试文件 40+ 处类型错误拖垮 build | exclude `**/__tests__/**`，另建 `tsconfig.test.json` | 低 |
| `backend/src/routes/voice.ts:16-18` | `Speech.listVoices` 在 OpenAI SDK 类型上不存在 | 改为类型安全的响应解析或使用 `client.models.list()` | 低 |
| `backend/src/server.ts:54` | `res` 未定义引用（鉴权中间件内） | 修正签名 `(_req, res, next)` | 低 |
| `backend/src/workspace/fs.ts:133` | `rm` 未导入（Node 22 需 `import { rm } from 'node:fs/promises'`） | 补导入 | 低 |
| `backend/src/agent/core.ts:314` | `context_compressed` 事件不在 `EventInput` union（session/events.ts） | 注册该事件类型 | 低 |

**收益**：恢复 `npm run build` / `npm run lint` / 后端 `npm run build`。**难度**：低。

### 1.2 收敛 RCE / 暴露面（安全最高优先）
| 位置 | 问题 | 建议 | 收益 | 难度 |
|---|---|---|---|---|
| `backend/src/routes/terminal.ts:7-23` | `POST /execute` 无鉴权直接 `execP(...,{shell:'zsh'})`，等价任意 shell | 复用 `toolRegistry` 的 `requiresApproval` 审批门或要求 token | 堵住无门槛 RCE | 低 |
| `backend/src/server.ts:64,102` | `cors()` 全开 + `app.listen(PORT)` 绑 0.0.0.0，任意网页/局域网可驱动 localhost 接口 | CORS 白名单（前端 origin）；`app.listen(PORT,'127.0.0.1')`（或 HOST env） | 消除 Drive-by CSRF 与 LAN 暴露 | 低 |
| `backend/src/routes/workspace.ts:13-16` | `?root=` 可把任意目录设为 workspace 根，配合 write/delete 全盘写删 | 去除 root override 或限定白名单目录 | 防越权文件操作 | 低 |
| `backend/src/tools/builtin.ts:208` + `agent-meta-tools.ts:137` | `vm.createContext(sandbox)` 可经 `this.constructor.constructor('return process')()` 逃逸，`run_code` 实为任意代码执行 | 隔离真实全局（`vm` + `contextify` 时去除 `process`/`require`/`Buffer` 或提供受控代理）或改用 `worker_threads`/子进程沙箱 | 修复"伪沙箱" | 中 |
| `backend/src/routes/mcp.ts:14-40` | 无鉴权即可配置 stdio MCP server 指定任意 command（自带完整 env） | 纳入鉴权 + 显式确认 | 封堵经配置的 RCE | 低 |
| `backend/src/tools/builtin.ts:146-154` | `read_file` 接受任意绝对路径（可读 `~/.ssh`、`.env`），`write_file` 反而受限 | 复用 `workspace/fs.ts` 的 `resolvePath` 包含校验 | 阻越权读敏感文件 | 低 |
| `backend/src/routes/model_provider.ts:216-227,290-298` | `GET /providers/:id`、`GET /current` 原样返回内存中的 apiKey | 出参剥离 apiKey / 仅回传掩码 | 防密钥泄露 | 低 |
| `backend/src/routes/knowledge.ts:64-75` | `/ingest` 的 `url` 直接 `axios.get`，可 SSRF 探测内网/元数据服务 | 限制 http(s)、禁止私网/链路本地地址 | 消除 SSRF | 中 |

---

## 2. P1 —— 高收益改进（建议 1 周内）

### 2.1 流式链路正确性（SSE）
| 位置 | 问题 | 建议 | 收益 | 难度 |
|---|---|---|---|---|
| `src/api/client.ts:262` | `streamAgentEvents` catch 到 AbortError 直接 `return`，Promise 永不 settle，点 Stop 后 await 永久挂起（泄漏） | catch 中 `reject(err)`（或 resolve 已收内容并关闭 reader） | 停止/清理语义正确 | 低 |
| `src/api/client.ts:244-257` | SSE 按 chunk 独立 `split('\n')`，事件跨 chunk 时行尾残片丢弃，大事件截断 | 维护 buffer，把未换行尾部并入下一块解析 | 流式事件不丢 | 中 |
| `backend/src/routes/agent.ts:100-130`、`workflow.ts:93-106`、`ollama.ts:34-50` | SSE 未监听 `req.on('close')`，客户端断连后 agent 继续跑 LLM/工具/写死 socket | AbortController + `req.on('close')` 贯穿 `agent.run` → `callLLM`/工具链 | 断连即释放资源、省 token | 中 |
| `src/api/client.ts:222` | SSE 用原生 fetch 绕过 axios 拦截器，`agent_api_key` Bearer 头未附加（后端配 AGENT_API_KEY 时流式 401） | 统一请求助手注入 Authorization | 鉴权一致 | 低 |
| `src/api/client.ts:211` | SSE 无心跳/空闲超时，半开连接永久挂起（axios 60s 超时对 fetch 无效） | 识别 keep-alive 注释行 + 读超时兜底（`AbortSignal.timeout`） | 断流可恢复 | 中 |

### 2.2 前端渲染性能（AgentChat 是重灾区）
| 位置 | 问题 | 建议 | 收益 | 难度 |
|---|---|---|---|---|
| `AgentChat.tsx:113-124` | 流式期间每 100ms `setInterval` 刷 `setElapsedMs`，整个聊天树每秒重渲染 ~10 次 | 计时器收进 memo 化的 `ElapsedBadge` 子组件 | 流式不卡顿 | 中 |
| `AgentChat.tsx:731-828` | 消息列表无虚拟化，气泡未 memo，每次流式 chunk 全量重渲染历史消息 | 抽出 memo 化 `MessageBubble` + 长会话引入 `@tanstack/react-virtual` | 长会话渲染量级下降 | 高 |
| `AgentChat.tsx:129-131` | 每个 text chunk `scrollIntoView({behavior:'smooth'})` | 贴近底部时 `scrollTop=scrollHeight` + 节流 | 滚动更顺滑 | 低 |
| `AgentChat.tsx:542-550` | `useMemo` 依赖 ref（`streamingTokensRef.current`），ref 变化不触发重算，memo 失效且渲染期读 ref + `performance.now()` 是杂质渲染（阻断 React Compiler） | 由 ticker state 驱动计算 | 修 tok/s 展示 + 渲染可预测 | 中 |
| `AgentChat.tsx:126,213` | AbortController 仅手动 Stop 时 abort，卸载/切会话不清理 | `useEffect(() => () => abortRef.current?.abort(), [])` | 杜绝跨会话污染 | 低 |
| `AgentChat.tsx:138-164` | 历史恢复 effect 依赖 `[]` 只跑一次，sessionId 变化不重载，且有竞态 | 以 sessionId 为 key 重载 + cancelled 标志 | 修复 fork 后历史错乱 | 中 |
| `src/App.tsx:2-16` | 13 个面板全静态 import，单 bundle 581KB（gzip 165KB） | 按 activeTab `React.lazy` + Suspense 懒加载；i18n 7 locale 按需动态 import | 首屏 JS 减半 | 中 |

### 2.3 后端执行正确性
| 位置 | 问题 | 建议 | 收益 | 难度 |
|---|---|---|---|---|
| `backend/src/routes/agent.ts:421-423` | `/context/compress` 的 SELECT 漏查 `id` 列，`older.map(m=>m.id)` 全 undefined，旧消息从未删除，仅插摘要（token 虚报） | SELECT 补 `id` 并 `DELETE ... WHERE id IN (...)` 批量删除 | 压缩真正生效 | 低 |
| `backend/src/agent/core.ts:747,811` | openai/anthropic SDK 未设 timeout/maxRetries（默认可达 10min），叠加 maxIterations=25 单轮可跑数小时 | 客户端 `timeout` + `maxRetries` 收敛，并加 per-turn 时钟预算 | 防挂死烧 token | 低 |
| `backend/src/agent/core.ts:442` | `runToolWithTimeout` 用 Promise.race 但超时不取消底层工具副作用；超时 rejection 让 `Promise.all` 抛错中断整轮 | 工具支持 AbortSignal；批内单工具失败独立 try/catch | 超时真取消、单失败不拖垮 | 中 |
| `backend/src/workflow/nodes.ts:52,175` + `graph.ts:66` | routerNode 新建独立 OpenAI client 无退避/超时；supervisor 每轮用同一 userMessage 重建 AgentCore 重复注入用户消息（上下文膨胀） | 抽公共 LLM 调用层（超时+重试+signal，同时解决 core/delegate/nodes 三处重复）；首轮注入一次 | 消除重复、防 token 浪费 | 中 |
| `backend/src/routes/model_provider.ts:194,281` | `currentProvider/providerConfigs` 进程级可变全局不持久化，且 `providerConfigs.apiKey` 从未被 /chat 消费（UI 配的 key 不生效） | 配置落 DB；/chat 从 providerConfigs 取 key | 修复死配置 | 中 |

### 2.4 i18n / 配置正确性
| 位置 | 问题 | 建议 | 收益 | 难度 |
|---|---|---|---|---|
| `src/i18n/locales/en.ts:193-210` 等 7 语言 | 9 个 `chat.*` 键用 `${var}`，i18next 默认插值是 `{{var}}`，界面显示字面量 `${toolName}` | 全部改 `{{var}}` 并同步 7 语言 | 聊天消息恢复正常 | 低 |
| `src/i18n/index.test.ts` | 无键对齐断言，实测非 en 语言缺 3-21 个键、en 缺组件在用的 8 个键 | 加 locale 键奇偶校验测试 | 翻译漂移自动拦截 | 低 |
| `src/theme.ts:56` + `index.html:11` | 主题初始化在 main.tsx 模块执行，浅色用户启动闪黑（FOUC） | index.html head 内联脚本先设 `data-theme` | 消除主题闪烁 | 低 |
| `src/apiConfig.ts:20` + `src/api/client.ts:12` | Tauri 模式 axios baseURL=`http://localhost:3001` 后 `api.get('/agent/tools')` 变 `/agent/tools`（缺 /api，后端全挂 /api 下 → 404），而 SSE 走 apiUrl 保留 /api | baseURL 统一 `getApiBase() ? getApiBase()+'/api' : '/api'` | 桌面端 REST 全部可用 | 低 |
| `src/components/Settings.tsx:63` | 超时设置（gen_timeout 30-300s）是无用 UI，axios 超时硬编码 60s | `applyApiBase` 时读取并设置 `api.defaults.timeout` | 设置真正生效 | 低 |
| `src/components/ModelManager.tsx:97-105` | apiKey/baseUrl 每敲一键就 POST `configureProvider`（网络风暴+写放大） | 防抖或失焦/按钮保存 | 减请求量 | 低 |

---

## 3. P2 —— 值得做

| 位置 | 问题 | 建议 | 难度 |
|---|---|---|---|
| `backend/tests/core-routes.test.ts:117-134` + `db/database.ts:6` | 测试直接写生产库 `data/agent.db`，/chat 与 /workflow/run 残留 sessions/messages | 支持 `AGENT_DB_PATH` env，测试指向 tmp 库 | 低 |
| `backend/src/knowledge/store.ts:465-488` | bruteforce 检索每轮把全库 chunk（含 embedding）拉进内存逐条 JSON.parse 算 cosine | 缓存解析后向量 / 限制候选集 / 真正启用依赖里已有的 sqlite-vec | 中 |
| `backend/src/agent/core.ts:108-123` | agent 每迭代同步执行 saveSession+logEvent+logUsage（各含 SELECT MAX+INSERT），阻塞事件循环 | 事件批量落库 / 合并 update / 节流 | 中 |
| `backend/src/prompts/store.ts:33`、`skills/store.ts:68`、`mcp/store.ts:53` | JSON `writeFileSync` 非原子写（崩溃即损坏），readAll 解析失败静默返回 [] 造成数据丢失 | temp+rename 原子写；解析失败告警；skills 内存缓存（每 turn 读盘） | 中 |
| `backend/src/routes/tasks.ts:28` | 列表接口对每个 task 单独 `getSteps()`（N+1） | 一次 IN 查询/JOIN | 低 |
| `backend/src/routes/session.ts:27-32` | `GET /:id/messages` 无 LIMIT，长会话全量 SELECT 进内存 | 分页/size 限制 | 低 |
| `backend/src/routes/knowledge.ts:60-108` | /ingest 的 text 无大小上限，超大文本切上千 chunk 一次 embed | 长度限制 + 异步队列 | 低 |
| `backend/src/tools/registry.ts:107` | approval key 无 TTL，SSE 断连/用户不审批时永久驻留 | TTL + 断连清理 | 低 |
| `backend/src/session/events.ts:79` | session_events 每事件同步写盘、无留存策略，长期会话磁盘无限膨胀 | 留存窗口 + 定期 purge | 中 |
| `backend/src/tools/builtin.ts:111,242` + `knowledge/store.ts:157` | web_search/weather/embed 无 timeout（可挂至 120s） | 统一 timeout/AbortSignal | 低 |
| `backend/src/agent/context-compressor.ts:242` | 用内容相等回找原索引，重复内容消息时压缩误删 | 分类时直接携带原索引 | 中 |
| `backend/src/agent/core.ts:709` | 重试对所有错误（含 401/400）都指数退避 | 仅对 429/5xx/网络错误重试 | 低 |
| `backend/src/mcp/manager.ts:40` | `config.args` 用 `split(/\s+/)` 拆参，带引号/空格参数错拆；MCP 工具默认全 requiresApproval 致每次调用等审批 120s | `shell-quote` 解析；细粒度审批 | 低 |
| `backend/src/computer-use/handlers.ts:39-72` | x/y 直接插值 AppleScript、keystroke/typeText 转义不完整，注入面 | 数值化校验 + 完整转义/白名单 | 低 |
| `backend/src/routes/agent.ts:111-149` + `workflow.ts:27-44` | assistant 消息落库、会话创建、用户消息落库逻辑在 /chat 与 /workflow/run 各重复两份 | 抽共享 message-store 模块 | 低 |
| `src/components/ImageGenerator.tsx:17-42`、`VideoGenerator.tsx:29-60` | `negativePrompt` 已收集但从未传给 API（死输入） | 请求体带上 | 低 |
| `src/components/WorkspacePanel.tsx:72,121` | 模块加载时求值 `getApiBase()`（改地址不生效）；data URI 用服务端可控 ext 直接拼 MIME | 每次调 `apiUrl()`；扩展名白名单 | 低 |
| `src/components/TasksPanel.tsx:103-106` | 3s 轮询 interval 依赖 `[]` 捕获首帧 fetchTasks，filter 永远用初始值 | ref 保存最新 fetchTasks | 低 |
| `src/components/RagHelp.tsx:142,168` | `JSON.parse(t(key))` 翻译缺失时白屏 | 安全解析兜底 | 低 |
| `src/test/setup.ts:38-43` | 全局过滤 console.error 可能掩盖真实错误 | 收窄过滤范围 | 低 |
| `src/App.tsx:38` + `Settings.tsx:52` | API key 明文存 localStorage；Tauri 壳无 keyring | 见 §5 前沿技术 | 中 |
| `eslint.config.js:20-26` | `no-explicit-any` 为 error，全库 30+ 处 `catch(err:any)` 使 lint 红 | 清理或按文件放行 | 中 |

---

## 4. P3 —— 可选优化 / 遗留问题

| 位置 | 问题 | 建议 | 难度 |
|---|---|---|---|
| `backend/src/server.ts:59-62` | 注册了两个相同的错误处理中间件，前一个在路由前是死代码 | 删一份 | 低 |
| `backend/src/server.ts:43-50` | `Object.values(Set)` 恒返回 `[]`，`AGENT_SKIP_AUTH_ROUTES` 前缀豁免失效 | `Array.from(SKIP_AUTH)` | 低 |
| `backend/src/server.ts:110-117` | 优雅停机不回收 computer-use 子进程、MCP stdio 子进程、进行中 SSE | shutdown 中 disconnectAll/stopServer | 中 |
| `backend/src/routes/image.ts:65`、`code.ts:66`、`video.ts` | 真实调用失败时返回 200 + mock 结果，掩盖上游错误 | 失败返回非 200 + 明确 error | 低 |
| `backend/src/agent/core.ts:35,46` | AgentCore 直接持有外部传入的 messages 引用，steer/hook 可改同一引用 | 构造时深拷贝 | 低 |
| `backend/src/agent/core.ts:80-101` | `extractFileModified` 正则解析工具输出脆弱（中文路径误判） | write_file 显式返回元数据 | 中 |
| `backend/src/agent/core.ts:743` | 每次调用 `new OpenAI()` | 模块级单例复用 | 低 |
| `backend/src/workflow/graph.ts:56-67` | 事件通道 10ms 忙轮询空转 CPU，queue 无上限 | push-based 缓冲/背压 | 中 |
| `backend/src/agent/hooks.ts:203` | `executeHooks` 无超时，hook 挂起则整轮挂死 | hook 超时 | 中 |
| `backend/src/routes/voice.ts:46-58` | /stt 接受任意大小 base64 全量进内存 | 大小限制 | 低 |
| `backend/tsconfig.json:15` | noEmit:true 但 build 脚本是 tsc（build 只类型检查不产出） | 明确 `--noEmit` 语义或真实产出 | 低 |
| `backend/package.json` | `@types/express@^5` 配 `express@^4.21`（类型与运行时不一致） | 统一升 express@5 或降 types 到 4 | 低 |
| 根目录 `fix_test.py` | 残留的测试正则修复脚本，且 AgentChat.test.tsx 仍有未用 `act`、`vi.spyOn(global,...)` | 删除脚本；测试用 `globalThis` | 低 |
| `src-tauri/tauri.conf.json:24` | `csp: null`，WebView 无内容安全策略 | 配置最小 CSP | 低 |
| `src-tauri/Cargo.toml` | edition 2021 / rust-version 1.70 | 升 edition 2024（需 rustc ≥1.85） | 低 |
| `src/components/FileTrackerPanel.tsx:246` | 渲染中 `Math.random()` 决定条宽（布局抖动 + 非确定性） | 路径哈希生成稳定宽度 | 低 |
| `src/index.html:7` | title 仍是 "Vite + React + TS" 占位 | 改产品名 | 低 |

---

## 5. 前沿技术引入建议（有依据、可落地）

1. **React Compiler**（自动 memo）—— React 19 官方，babel-plugin-react-compiler 已稳定。
   - 前置条件：清掉渲染期杂质（AgentChat 的 `performance.now()`、FileTrackerPanel 的 `Math.random()`）后接入，配 `eslint-plugin-react-compiler`。
   - 收益：免手工 memo 即获得流式场景下的大幅重渲染优化。**难度：中**。
2. **精确 token 计数替代字符估算** —— 我们上轮做的上下文利用率目前用 CJK/字符启发式。引入 **gpt-tokenizer**（纯 JS、无 wasm 负担，比 js-tiktoken 更轻）或 **js-tiktoken**（官方 BPE 实现）。
   - 收益：上下文利用率从"估算"变"精确"，`/context/compress` 的压缩收益也能真实核算。**难度：低**。
3. **@tanstack/react-virtual** —— 消息列表虚拟化，AgentChat 长会话流式渲染的必要底座。**难度：高**（需处理自动滚动锚点）。
4. **Express 5** —— 官方已稳定多年；本项目 `@types/express@5` 已就位，运行时升 5 成本低，获得原生 async 错误转发（可删掉一半 try/catch 样板）。**难度：低**。
5. **Tauri 密钥托管** —— API key 从 localStorage 迁到 `tauri-plugin-stronghold`（本地加密存储）或系统 keyring 插件，同时收紧 `csp: null`。**难度：中**。
6. **真沙箱执行代码** —— `run_code`/`execute_code` 若要保持"沙箱"语义，可评估 `isolated-vm`（真 v8 隔离，但需 native 编译）或 worker_threads + 受限 API 面；若不做，应在 UI/文档中如实标注为"本地执行"。**难度：高**。

## 6. 小众但实用的方案

1. **`shell-quote`（或 `@yarnpkg/parsers` 的 shell-parser）** —— 替代 MCP config 的 `split(/\s+/)`，正确解析带引号/空格参数。**低**。
2. **原子写模式（temp + rename）** —— prompts/skills/mcp 三个 JSON store 一行 `fs.writeFileSync` 改成 `writeFile(tmp) + rename()`，崩溃不损坏配置。**低**。
3. **`AbortSignal.timeout()`** —— Node 22 内置，SSE 读超时与 LLM 调用超时一行搞定，零依赖。**低**。
4. **SSE keep-alive 注释行（`: ping\n\n`）** —— 服务端每 15-30s 写心跳，前端据此判活重连，这是 SSE 规范内置的廉价保活手段，多数实现漏掉。**低**。
5. **`structuredClone` / 构造期深拷贝** —— AgentCore 的 messages 引用隔离，防 steer/hook 串扰。**低**。
6. **批量事务写 usage_log/session_events** —— better-sqlite3 的 `db.transaction()` 已在 fork 用过，扩展到 agent 热循环的逐事件写盘。**中**。

---

## 7. 建议实施顺序（里程碑）

- **M1（0.5-1 天）安全止血**：§1.2 全部 —— 绑 127.0.0.1、CORS 白名单、terminal/MCP 审批门、read_file 路径校验、apiKey 脱敏、SSRF 拦截。
- **M2（0.5-1 天）构建绿灯**：§1.1 全部 + 删除 fix_test.py、修 AgentChat.test.tsx 类型。
- **M3（2-3 天）流式链路**：§2.1 全部（abort settle、chunk buffer、req.on('close') 取消 agent、心跳）+ §2.3 的 LLM 超时与 /context/compress 修复。
- **M4（2-3 天）渲染与体验**：§2.2 的 ElapsedBadge、滚动优化、React.lazy 代码分割、i18n `${}` 修复、主题 FOUC。
- **M5（持续）**：§3 各 P2 项按成本排序消化，前沿技术（§5）逐个试点。
