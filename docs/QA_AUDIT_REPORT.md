# AI Agent 桌面应用 — 测试覆盖与质量风险审计报告

审计人：Edward（QA Engineer）｜审计日期：2026-08-24｜审计方式：实测 + 源码走读（未修改任何代码）

---

## 一、测试现状总结

实测命令（本机执行结果）：

| 项 | 前端 | 后端 |
|---|---|---|
| 运行命令 | `npx vitest run` | `cd backend && node --import tsx --test --test-concurrency=1 tests/*.test.ts` |
| 测试文件数 | 15 | 23 |
| 用例数 | 113 | 147 |
| 通过 / 失败 | 113 / 0 ✅ | 147 / 0 ✅ |
| 跳过 / only / todo | 0 / 0 / 0 | 0 / 0 / 0 |
| 耗时 | ~4.8s | ~73.8s |
| 警告 | 无 | DEP0040 punycode 弃用警告（依赖引起，非用例失败） |

- 前后端均**全绿**，无 `.skip/.only/.todo`，门禁（i18n 键对齐、沙箱隔离、审批门、工作流异常路由）确实在生效。
- 后端 23 个测试文件覆盖率集中在：context-compressor(28)、knowledge-config(14)、sandbox(9)、core-routes(9)、workspace(7)、texttools(7)、research(7，含 drift/metacog)、knowledge-vec(7)、workflow(6)、registry(6)、memory(6)、telemetry(5)、plugins(5)、hooks(5)、git(5) 等。
- **关键结论：数量健康，但"广度"存在明显空洞——大量核心模块 0 覆盖，且测试自身存在真实库污染问题。**

---

## 二、覆盖缺口清单（按风险排序）

### 🔴 高（最可能回归 / 最影响用户）

**1. SSE 客户端解析器 `streamAgentEvents` 零测试**
- 位置：`src/api/client.ts:232-309`（783 行 API 客户端中唯一流式通道）
- 缺什么：组件测试全部 mock `agentApi.chat`，SSE 的 `data:` 行解析、跨 chunk 断行缓冲合并、`: ping` 心跳跳过、idle timeout 主动 abort、非 2xx 响应、空流、AbortError reject 分支**从未被执行**。
- 建议补：mock `global.fetch` 返回 `ReadableStream`，分多个 chunk 喂入 `data:` 行 → 断言 `onEvent` 事件顺序与顺序内容；喂半行再补全 → 断言缓冲拼接；用 fake timers 推进 idle 超时 → 断言 reject 与 AbortController.abort 被调；返回 500 → 断言 reject 文案。

**2. 审批门 deny 路径（含 approve 成功链路）无端到端测试**
- 位置：`backend/src/routes/agent.ts:170-184`（POST /tools/approve）+ `backend/src/tools/registry.ts:149-165`（审批门）
- 缺什么：现有用例只测 `PENDING_APPROVAL`（core-routes.test.ts:50-58、registry.test.ts:39-52）。**approve 成功后带 token 执行成功、deny 后同 key 原 token 仍被拦、/approval-state 三态、TTL 过期清理**均未测。
- 建议补：`POST /tools/approve {action:'approve'}` → 用返回 token 调 `executeTool` → 断言 success；`{action:'deny'}` → 断言 `__DENIED__` 后原 token 执行仍 PENDING_APPROVAL；GET /tools/approval-state 断言 pending/approved/denied；fake timers 推进 10min 断言 Map 清空。

**3. 后端测试污染真实开发库 `backend/data/agent.db`（最严重测试质量问题，见第三节第 1 条）**
- 位置：`backend/src/db/database.ts:7`（`DB_PATH = process.cwd()/data/agent.db`，测试与开发共用）
- 实测证据：`data/agent.db-wal` 修改时间 23:48 恰为我跑完测试的时间；`memory.test.ts:22` 执行 `DELETE FROM global_memories`；`knowledge-config.test.ts:114-116` 清空 `knowledge_chunks/knowledge_docs` 并重置 `rag_config`；`core-routes.test.ts:117-134` 通过 `/agent/chat`、`/workflow/run` 真实写入 sessions/messages 且**不清理**。
- 建议补：测试入口统一注入 `DB_PATH` 指向 `mkdtemp` 临时目录（或 `:memory:`），`test.before` 全局切换；至少对破坏性用例加备份/恢复。

**4. 零测试的高价值路由**
- 位置：`backend/src/routes/model_provider.ts`(529 行)、`tasks.ts`(173 行)、`ollama.ts`(178 行)、`knowledge.ts`(266 行，ingest/delete/rebuild/index-sync 未测)、`code.ts`(280 行)、`session.ts`(110 行)、`image.ts`/`video.ts`/`voice.ts`
- 缺什么：自定义 provider CRUD/discover/test、任务生命周期（pause/resume/complete/fail）、ollama 模型拉取、知识库重建/索引同步、代码分析生成重构、会话 CRUD/audit/memories —— 全部无任何用例。
- 建议补：每个路由冒烟 + 参数校验（400/404）+ 外部服务失败降级（如 discover-models 失败返回 200 + error 字段已实现于 model_provider.ts:470-479，应固化）。

### 🟡 中

**5. /agent/chat SSE 断连与心跳分支**
- 位置：`backend/src/routes/agent.ts:78-125`
- 缺什么：客户端中途断连（`res 'close'` → abort）、断连后不保存消息（line 109 `!abort.signal.aborted`）、心跳 `clearInterval` 清理、`res.write` 在已销毁 socket 上抛 EPIPE 未捕获 —— 均无测试。
- 建议补：真实 http 客户端发起 /chat 后立即 `destroy()` 连接，断言服务端不崩溃、无残留 interval、DB 中无半截 assistant 消息。

**6. 前端 20+ 组件零测试（按副作用密度排序）**
- 位置：McpPanel(10 处副作用)、ModelManager(9)、WorkspacePanel(9)、ComputerPanel(7)、LLMFlameChart(6，3s 轮询+ResizeObserver)、ExperimentLab(5，AbortController)、TerminalPanel(5)、TasksPanel(5)、MemoryPanel(4，provider 切换)、GitPanel、TextTools、PluginsPanel、DriftPanel、MetacogPanel、SkillsPanel、VoicePanel、ImageGenerator、VideoGenerator、CodeTools、ToolsPanel、SystemMonitor、Sparkline（均在 `src/components/`）
- 建议补：优先 MemoryPanel（provider 激活/反激活/搜索/注入开关持久化）、ExperimentLab（运行中 abort、单 run 失败仍聚合、winners 计算）、LLMFlameChart（空态/数据/3s 刷新/清空）、McpPanel（连接失败态、工具列表空）、TasksPanel（状态流转按钮）。

**7. AgentChat 虚拟化长列表分支从未执行**
- 位置：`src/components/AgentChat.tsx:112-127, 809-817`（`messages.length > 60` 才启用 `useVirtualizer`）
- 缺什么：37 个用例最多渲染个位数消息，虚拟化分支（含 `scrollToIndex` 到底）是测试死角。
- 建议补：mock `sessionApi.getMessages` 返回 70+ 条历史消息渲染，断言不崩溃、底部可见、virtualizer 渲染行数 << 总消息数。

**8. Settings 快捷键录制流程未测**
- 位置：`src/components/Settings.tsx:58-76`（keydown 捕获）、`362-405`（冲突 UI/重置）
- 缺什么：Settings.test.tsx 只测 section 切换（2 用例）。录制按键→绑定更新+localStorage 持久化、冲突警告显示、reset 恢复默认、esc 取消 —— 均未测。
- 建议补：点击录制按钮 → fireEvent.keyDown 组合键 → 断言绑定更新与 storage；预设冲突绑定 → 断言 AlertCircle 警告；点 reset → 断言恢复 DEFAULT_SHORTCUTS。

**9. drift 阈值/容量边界**
- 位置：`backend/src/telemetry/drift.ts:13-14`（DRIFT_THRESHOLD=0.6、MIN_SAMPLES=3、MAX_HISTORY=200、MAX_SESSIONS=200）
- 缺什么：research.test.ts:13-38 只测"低分/高分"定性；边界（score≈0.6 翻转、2 条消息不评、3 条首评、超 200 会话淘汰、超 200 历史裁剪）未测。
- 建议补：构造已知文本逼近阈值断言 isEvent 翻转；MIN_SAMPLES 边界；循环 201 个 sessionId 断言最老被淘汰；灌 205 条 history 断言长度 200。

**10. /context/compress 破坏性路由无测试**
- 位置：`backend/src/routes/agent.ts:380-454`
- 缺什么：compress 会真实 `DELETE FROM messages` 并插入摘要（line 430-441），但无路由级测试（context-compressor.test.ts 只测纯函数层）。
- 建议补：建测试会话灌消息 → POST /context/compress → 断言 savings/数量、`msgs.length<=4` 不压缩分支、DB 行数变化、摘要块存在。

**11. memory 双 provider 失败容错未验证**
- 位置：`backend/src/memory/registry.ts:84-102`（`Promise.allSettled` 容错已实现）
- 缺什么：memory.test.ts 只测 happy path 合并；"一个 provider search 抛错时另一个仍返回"这一关键容错行为无用例。
- 建议补：注册 search 抛错的假 provider + local → `searchAllMemories` → 断言只返回 local 结果、不 reject。

**12. i18n 插值变量未对齐校验**
- 位置：`src/i18n/keys.test.ts:26-50`（只校验键集合一致 + `${var}` 语法）
- 缺什么：同键翻译的 `{{var}}` 插值变量集合未校验——若 bo/fa 漏写 `{{count}}`，界面会显示原样参数。
- 建议补：对每个 key 提取 `{{...}}` 集合，断言 7 语言完全一致（含参数数量）。

**13. 插件加载失败路径**
- 位置：`backend/src/routes/plugins.ts`（loadPlugins / run）
- 缺什么：plugins.test.ts 只测 happy path + unknown 404；语法错误 JS、无效导出、load 抛错、run 时插件内抛错未测。
- 建议补：向临时目录写坏插件文件后 loadPlugins，断言跳过不崩、列表不含坏插件；run 抛错断言 error 字段。

### 🟢 低

**14. useTTS 仅测设置同步**
- 位置：`src/hooks/useTTS.ts`（264 行）vs `__tests__/useTTS.test.tsx`（只测 localStorage↔focus 同步）
- 缺什么：speakNative/speakApi/stop/pause/resume、utterance onend/onerror、audio.play() 拒绝路径未测。
- 建议补：mock speechSynthesis 与 HTMLAudioElement，测播放状态机与错误分支（audio 播放失败置 error）。

**15. 其余低风险空白**
- git 路由只有错误路径（git.test.ts），真实仓库 status/log/diff/commit 成功路径需 fixture repo；GitPanel 无测试。
- theme 只测 matchMedia matches:false（亮色），暗色 OS 分支未测。
- App.tsx 无测试（tab 路由/lazy/ErrorBoundary/快捷键接线）；ErrorBoundary 组件本身无测试；useLocalStorage hook 无测试。

---

## 三、测试质量问题清单

**1. 🔴 后端测试写真实开发库**（同二-3）：`memory.test.ts:22` 清空全部全局记忆、`knowledge-config.test.ts:114-116` 清空知识库并重置 RAG 配置、`core-routes.test.ts` 的 /chat 与 /workflow/run 残留 sessions/messages 不清理。开发者跑一次套件即丢用户数据。**修复优先级最高。**

**2. 🟡 setup.ts 全局屏蔽 act() 警告**：`src/test/setup.ts:38-43` 过滤 `not wrapped in act` 与 `An update` 警告。这会掩盖"组件未清理异步/定时器"的真实问题（如 LLMFlameChart 3s interval 若被测试渲染会静默泄漏）。建议改为按用例断言无警告，而非全局吞掉。

**3. 🟡 进程级副作用依赖串行**：`registry.test.ts:9` 全局 `process.env.WORKSPACE_ROOT='/tmp'`；模块级单例（drift sessions Map、llm-tracer、approval map、memory providers）在测试间残留。目前靠 `--test-concurrency=1` 与唯一 id 规避，一旦并行化即 flaky。

**4. 🟡 真实时序依赖**：`system.test.ts:36` 真实 sleep 1100ms（依赖真实 CPU 采样）；`workflow.test.ts:136` 40ms sleep 断言流式顺序。慢机器上存在 flaky 风险，且拖慢套件（73.8s 主要耗在这里）。

**5. 🟢 空洞断言少，但存在"只测设置不测行为"**：useTTS/theme 部分用例只验证 getter/setter 往返，未触发真实行为路径（语音播放、暗色主题解析）。整体断言质量尚可（AgentChat 行为断言、sandbox 隔离断言、i18n 键对齐均为有效断言），未见"只测不报错"的空壳。

---

## 四、健壮性风险清单（不限于测试）

**1. 🔴 Express 4 async handler 未捕获 rejection**：`backend/src/routes/agent.ts:44-49` 的 `ensureSession`/`saveUserMessage`/`loadMessages`（line 69）均在 try 块外，DB 异常 → async handler reject → 不经过 `server.ts:134` 统一错误中间件 → 500 无 JSON 或进程级 unhandledRejection。建议统一 `asyncHandler` 包装或把 DB 操作纳入 try。

**2. 🟡 computer-use stopServer SIGKILL 兜底失效（进程泄漏）**：`backend/src/computer-use/manager.ts:181-187`——`setTimeout` 注册后立即 `this.serverProcess = null`（line 187），3 秒后回调里 `this.serverProcess?.exitCode === null` 恒为 false，**SIGKILL 永远不会发出**，SIGTERM 杀不掉的子进程将成孤儿。建议先取局部引用再判空。

**3. 🟡 SSE 断连竞态下 `res.write` 可能抛 EPIPE**：`backend/src/routes/agent.ts:96-104` 写循环内未捕获 write 异常，abort 检测存在竞态窗口，极端情况下触发未处理 'error' 事件。建议对 write 包 try/catch 或监听 res 'error'。

**4. 🟡 MCP reconnect 状态小泄漏**：`backend/src/mcp/manager.ts:155-171`——若 `connect()` 意外抛错（非返回 statusOf），`this.reconnecting.delete(id)` 不执行；且 `stopReconnectLoop` 后 `reconnectTimer` 虽置 null（line 190）但 interval 未 unref，长驻进程无碍、测试场景会挂起。建议 try/finally 清理。

**5. 🟢 资源句柄整体良好**：git 用 `execFile` + 15s timeout + maxBuffer（git.ts:32）；terminal 用 `execP` 捕获 ETIMEDOUT/SIGTERM（handlers.ts:188-220）；MCP `client.close()` 均 best-effort；approval TTL 10min 防内存驻留；llm-tracer 环形缓冲 1000 条、drift 会话上限 200。这些是加分项。

---

## 五、依赖健康

**后端**：`ts-node`、`nodemon` 为未使用 devDependencies（scripts 全部用 tsx）；`@types/uuid` 冗余（uuid@14 自带类型）。版本落后：express 4→5、openai 4→7、zod 3→4（均为大版本，升级需专项验证）。
**前端**：无未使用依赖；大版本落后：vite 6→8、@vitejs/plugin-react 4→6、typescript 5.8→7、eslint 9→10；`lucide-react 1.25→1.34`、`i18next 26.3→26.4` 可安全小升。

---

## 六、测试补强路线图

### 必补（P0 — 先做，防数据损失 + 堵最热路径）
1. **测试环境 DB 隔离**：`DB_PATH` 支持环境变量指向临时库，测试入口统一切换；给 core-routes 的 /chat、/workflow/run 加数据清理。← 唯一前置项
2. `streamAgentEvents` SSE 解析/缓冲/idle abort 单测（client.ts:232-309）
3. 审批 approve/deny 全链路 + /approval-state 三态（agent.ts:170-184）
4. /agent/chat 断连分支 + 心跳清理（agent.ts:78-125）
5. /context/compress 路由测试（破坏性操作必须锁行为）

### 应补（P1 — 一个迭代内）
6. 零覆盖核心路由：model_provider、tasks、knowledge(ingest/delete/rebuild/index-sync)、ollama、code、session
7. MemoryPanel 组件 + memory 双 provider 失败容错（registry.ts allSettled 行为固化）
8. ExperimentLab（abort/单 run 失败聚合）、LLMFlameChart（空态/刷新/清空）、McpPanel（失败态）关键组件
9. AgentChat 虚拟化分支（60+ 消息）
10. Settings 快捷键录制/冲突 UI
11. drift 阈值/容量边界、metacog parse 边界、i18n 插值变量 7 语言对齐
12. 修复健壮性问题：computer-use stopServer SIGKILL 兜底、agent.ts SSE EPIPE、async handler 未捕获 rejection

### 可补（P2 — 储备）
13. useTTS 播放状态机、theme 暗色分支、App/ErrorBoundary、useLocalStorage
14. git fixture repo 成功路径测试
15. 清理 ts-node/nodemon/@types/uuid；依赖升级专项（vite/express/openai/zod）

---

*附：审计过程实测结果——前端 113/113 通过（15 文件，4.8s）；后端 147/147 通过（23 文件，73.8s）；前后端均无 skip/only/todo。报告所有行号/路径均来自本机源码走读。*
