# QA 验证报告：后端中等档改造（T01–T04）独立验证（第一轮 + Round 2 回归）

> QA 工程师：严过关（Edward）· 日期：2026-08-25
> 范围：R2/R3/R4/R5 后端改造（T01 基础设施 / T02 审批加固 / T03 记忆检索 / T04 MCP 白名单+危险工具）
> 方法：独立于工程师用例，新增 17 个验证用例（`backend/tests/qa-independent.test.ts` 16 + `qa-independent-persist.test.ts` 1），另做源码安全审查与边界探测。

---

## 0. 结论摘要

| 项 | 结果 |
|---|---|
| 工程师基线全量回归（`npm test`） | ✅ 177/177 通过 |
| 后端 `tsc --noEmit` | ✅ 0 错误 |
| 含 QA 新增后的全量 | 194 用例：190 通过 / **4 失败（均为源码缺陷演示，非测试缺陷）** |
| QA 独立新增用例 | 17 个：13 通过 / **4 失败** |
| 发现的源码 Bug | **4 个**（1 高 / 2 中 / 1 低） |
| 智能路由判定 | **Send To: Engineer（Alex）** — 源码存在 Bug，需修复后 Round 2 回归 |

---

## 1. 独立测试结果

### 1.1 工程师基线（复跑，非复现其用例结论）

```
npm test                → # tests 177 / # pass 177 / # fail 0
npx tsc --noEmit        → exit 0（0 错误）
```

### 1.2 QA 独立新增用例（`backend/tests/qa-independent*.test.ts`）

| # | 用例 | 关联 AC | 结果 |
|---|---|---|---|
| 1 | QA-R3-1 同一请求 401 响应头与全部日志 rid 一致 | AC-R3-1 | ✅ |
| 2 | QA-R3-2 统一 errorHandler 脱敏 api_key/Bearer/长密钥 | AC-R3-2 | ✅ |
| 3 | QA-R3-2-BUG 路由级错误响应（/test-openai）泄露明文 api_key | AC-R3-2 | ❌ **BUG-1** |
| 4 | QA-R3-2-EDGE safeErrorMessage 无法掩码 "API key provided: sk-xxx" | AC-R3-2 | ❌ **BUG-2** |
| 5 | QA-R4-1 无鉴权 POST/GET → 401 且开关不变 | AC-R4-1 | ✅ |
| 6 | QA-R4-2 无 confirm 关闭 → 400 不变；带 confirm → 200；开启无需 confirm | AC-R4-2 | ✅ |
| 7 | QA-R4-3 成功/失败切换均写 approval_toggle 审计 | AC-R4-3 | ✅ |
| 8 | QA-R5-2 fail-closed：无 allowedTools → 0 工具 + TOOL_NOT_FOUND | AC-R5-2 | ✅ |
| 9 | QA-R5-3 全局审批关闭时危险工具仍 PENDING_APPROVAL，非危险豁免 | AC-R5-3 | ✅（修复自身测试后） |
| 10 | QA-R5-EDGE 下划线工具名白名单精确匹配；白名单外 TOOL_NOT_FOUND | AC-R5-1 | ✅ |
| 11 | QA-R5-EDGE 危险判定边界（save_settings 误伤接受 / rmdir 漏判） | Q-R5-2 | ❌ **BUG-3** |
| 12 | QA-R2-1 FTS 触发器增删改同步；预筛候选包含新行 | AC-R2-1 | ✅ |
| 13 | QA-R2-2 中英混合查询 topK 语义等价 | AC-R2-2 | ✅ |
| 14 | QA-R2-EDGE 空查询/特殊字符/FTS 语法词不崩溃返回 [] | — | ✅ |
| 15 | QA-R2-EDGE TTL 过期后缓存失效 | AC-R2-3 | ✅ |
| 16 | QA-R2-BUG 多段中文查询召回回归（"开源 项目" → 0 命中） | AC-R2-2 | ❌ **BUG-4** |
| 17 | QA-R4-4 审批开关 DB 重开 + 全新 registry 模块加载持久化 | AC-R4-4 | ✅（独立文件） |

**通过 13 / 失败 4。**

---

## 2. 发现的源码 Bug（不修改，仅记录，转交工程师）

### BUG-1 【高】R3：路由级错误响应未脱敏，明文 API key 泄露（违反 AC-R3-2）

- **位置**：`backend/src/routes/agent.ts`
  - L123（`/chat` SSE 错误事件）：`res.write(data: {type:'error', error: message})`
  - L140（`/chat` 非流式）：`res.status(500).json({ error: message })`
  - L243（`/test-openai`）：`res.json({ ok:false, message })`
  - L264（`/test-anthropic`）：`res.json({ ok:false, message })`
- **复现**：mock 上游返回 `{"error":{"message":"Invalid api_key=sk-abcdef1234567890abcdef supplied"}}`（OpenAI SDK 会原样透传为 `AuthenticationError` 的 message），POST `/api/agent/test-openai`（body 带 `apiKey`）：
  - 实际响应体：`{"ok":false,"message":"401 Invalid api_key=sk-abcdef1234567890abcdef supplied"}` —— **明文 key 出现在 HTTP 响应**
  - 日志侧已脱敏（`logError` → `401 Invalid api_key=*** supplied`），仅响应侧漏。
- **预期**：响应经 `safeErrorMessage` → `401 Invalid api_key=*** supplied`，不含明文。
- **同类模式（供一并核查）**：`routes/workflow.ts` L106（SSE）、`routes/system.ts` L152、`routes/knowledge.ts` L167/194/225/237/253、`routes/ollama.ts` L63/116/168、`routes/workspace.ts` L60/74/95/110、`routes/memory.ts` L85、`routes/texttools.ts` L187 —— 均为 try/catch 内直接返回原始 `err.message`，绕过统一 errorHandler。provider 调用类（agent/workflow）风险最高，因用户密钥会进入请求。

### BUG-2 【中】R3：safeErrorMessage 无法掩码常见 OpenAI 错误格式（AC-R3-2 边界）

- **位置**：`backend/src/utils/error-mask.ts` L7-9
- **复现**：`safeErrorMessage('Incorrect API key provided: sk-test1234567890abcdefgh. You can find')` → **原样返回**（未掩码）。
- **原因**：规则 `(api[_-]?key|token|secret)\s*[:=]` 要求 key 后紧跟 `:`/`=`；而 OpenAI 标准格式是 `API key provided: `（"API" 与 "key" 之间有空格、key 后跟 "provided"），不命中；值 `sk-test...` 24 字符 < 32，`{32,}` 规则也不命中。
- **预期**：该格式（最常见的真实泄露格式）也应掩码为 `sk-test***`。
- **影响**：即使走统一 errorHandler/logError 的路径，该格式仍可能泄露。

### BUG-3 【低】R5：`rmdir` 未被识别为危险工具（AC-R5-3 边界）

- **位置**：`backend/src/tools/dangerous.ts` L14（`rm\b` 词边界）
- **复现**：`classifyDanger('rmdir')` → `null`（不危险）。
- **预期**：`rmdir`（删除目录的 shell 命令）应识别为 `shell_exec`（或 `file_write`）。
- **影响**：若某 MCP 工具名恰为 `rmdir`，全局审批关闭时可免审批执行。`remove_directory`/`delete_directory` 可被 `remove`/`delete` 命中，唯 `rmdir` 漏网。

### BUG-4 【中】R2：多段中文查询召回回归（违反 AC-R2-2 语义等价）

- **位置**：`backend/src/memory/fts.ts` L81 `(q.match(/[\u4e00-\u9fff]+/g) ?? []).join('')`
- **复现**：记忆 `开源社区项目今天完成`；`search('开源 项目')` → **0 命中（候选集为空）**。
- **原因**：两个独立 CJK 段 "开源"+"项目" 被 `join` 成连续串 "开源项目"，走 trigram MATCH；内容为 "开源社区项目"（含 "开源"、"项目" 但不连续），trigram 需 ≥3 连续子串 → 无候选。旧逻辑（逐字符 tokenize + 重叠打分）可召回。
- **预期（AC-R2-2）**：该记忆应仍在 topK（"召回内容不应明显变差"）。
- **补充**：`search('acs 项目')`（英文词 + 2 字中文）可正常召回（英文分支 + LIKE 分支），证明问题仅出现在"多个 CJK 段被 join 为一个连续串"的场景。建议按段分别走 trigram/LIKE 再取并集。

---

## 3. 发现的测试缺口（工程师用例应覆盖未覆盖）

1. **AC-R3-2 路由级错误响应**：`tests/request-context.test.ts` 仅用 mini app `next(err)` 测统一 errorHandler，未覆盖真实路由（/chat、/test-openai、/test-anthropic）的 try/catch 错误分支 → 漏掉 BUG-1。
2. **AC-R2-2 多段中文查询**：`tests/memory.test.ts` 只测单段中文（"今天下午三点"、"产品路线图"、"预算"），未测多段 CJK join 场景 → 漏掉 BUG-4。
3. **危险判定边界**：`tests/mcp.test.ts` 只测 write_file/exec/read_note，未测 `rmdir` 等词边界/漏判案例 → 漏掉 BUG-3。
4. **AC-R4-4 全链路**：`tests/approval-persist.test.ts` 只验证 `settingsStore` 直接落库 + DB 重开读行，未覆盖 "API/registry 公共入口 → 落库 → 全新模块加载读到" 的完整链路（QA 的 `qa-independent-persist.test.ts` 已补）。

---

## 4. 测试代码自身问题（QA 已自行修复）

- 首轮 `QA-R5-3` 失败：我在白名单中漏配 `mcp__qa-danger__exec`（exec 未注册导致 `toolRegistry.get(...)` 为 undefined）。属**测试代码 Bug**，已按规则自行修复（Round 1 内 self-fix），修复后该用例通过，未影响源码判定。
- **TQ-1（工程师用例脆弱性提示）**：`tests/approval.test.ts` AC-R4-3 断言 `rows.length === 3` 依赖同文件前序用例（AC-R4-2 的 rejected 记录）执行顺序；当前全绿，但新增/重排用例会破坏，建议改为增量断言（按 created_at/rowid 截取本用例新增行）。

---

## 5. 安全/正确性审查补充结论（通过项）

- **requestId 中间件挂载顺序**（server.ts L75 在最前、rateLimit 之前）：401/429/500 均带 `X-Request-Id`；`finish` 回调重新包 ALS，日志 rid 与响应头一致 ✅
- **默认随机 API key + auth 无条件挂载**（决策 A）：无 `AGENT_API_KEY` 时随机生成，`/api/*` 无鉴权一律 401；健康检查经 SKIP_AUTH 放行 ✅
- **console 收敛（AC-R3-3）**：`backend/src` 下仅 `utils/logger.ts` L24/26（logger 自身实现）+ 2 处注释，无新增裸 console ✅
- **R4 二次确认与审计**：`enabled=false` 缺 `confirm` → 400 且开关不变；成功/失败均写 `approval_toggle`（input 含 actor=requestId|ip）✅
- **R5 fail-closed + 危险不可豁免**：无 allowedTools → 0 工具；危险工具全局关闭仍 PENDING_APPROVAL；非危险豁免；disconnect 反注册 ✅
- **R2 缓存失效**：add/update/remove 均 `invalidateMemoryCache()`；TTL 过期验证通过；FTS 触发器增删改同步计数一致 ✅

---

## 6. 智能路由判定

- **判定**：**Send To: Engineer（Alex）** —— 源码存在 4 个 Bug（BUG-1 高 / BUG-2 中 / BUG-3 低 / BUG-4 中），需修复。
- **Round 状态**：Round 1 完成（QA 自修 1 个测试 bug，剩余 4 个失败均为源码缺陷）。
- **Round 2 建议**：工程师修复后，QA 重跑 `tests/qa-independent*.test.ts`（4 个失败用例应转绿）+ 全量 `npm test` + `tsc`；若仍有失败，按规则直接记录为 Known Issues 收尾，不进入 Round 3。

## 7. 附：复现命令

```bash
cd /Users/alancouny/Desktop/agent/backend
# 全量（含 QA 新增）：194 用例，190 通过 / 4 失败（均为 BUG-1~4 演示）
npm test
# 仅 QA 独立用例
node --import ./tests/helpers/preload.mjs --import tsx --test --test-concurrency=1 tests/qa-independent.test.ts tests/qa-independent-persist.test.ts
npx tsc --noEmit
```

---

# Round 2 回归结论（2026-08-25，工程师修复后）

## R2-0 总览

| 项 | 结果 |
|---|---|
| QA 独立用例复跑（17 个） | ✅ **17/17 全绿**（4 个旧失败用例已全部转绿） |
| 全量 `npm test` | 200 用例：**195 通过 / 5 失败**（5 个失败均为**环境守卫**，非代码回归，见 R2-2） |
| `tsc --noEmit` | ✅ 0 错误 |
| 工程师新增回归断言 | error-mask +3 / mcp +1 / memory +1，全部通过且质量良好 |
| 修复质量审查（BUG-1~4） | ✅ 无遗漏、无过度脱敏、无排序/召回退化 |
| 智能路由判定 | **NoOne（后端无源码 Bug）**；5 个全量失败为环境守卫，建议守卫阈值重置后重跑确认 200/200 |

## R2-1 Bug 修复验证（4/4 已修复，QA 用例转绿）

| Bug | 修复位置 | QA 用例（此前失败 → 现在） | 结论 |
|---|---|---|---|
| BUG-1 路由级错误响应脱敏 | `routes/agent.ts` L121/141/246/268/286、`knowledge.ts`×6、`ollama.ts`×3、`system.ts` L152、`workflow.ts` L104、`workspace.ts` L26/30/43、`texttools.ts`×5、`memory.ts` L87、`mcp.ts` L37 | QA-R3-2-BUG → ✅ | ✅ 已修 |
| BUG-2 error-mask 空格 + 短 sk- key | `utils/error-mask.ts` L11 新增 `\bsk-[a-z0-9_-]{8,40}\b` | QA-R3-2-EDGE → ✅ | ✅ 已修 |
| BUG-3 rmdir 漏判 | `tools/dangerous.ts` L14 `FILE_WRITE_PATTERN` 增补 `rmdir` | QA-R5-EDGE(边界) → ✅ | ✅ 已修 |
| BUG-4 多段中文召回回归 | `memory/fts.ts` L83-104 改为按 CJK 段分别预筛取并集 | QA-R2-BUG → ✅ | ✅ 已修 |

### 修复质量评估（重点项）

- **BUG-1 无遗漏/无过度**：8+ 文件全部走 `safeErrorMessage`；`routes/workspace.ts` 的 `httpError()` 仍按 `err.code` 分支映射状态码（EACCES_ROOT/ENOTFILE/ETOOLARGE/ENOENT/EACCES/ENOTEMPTY），仅对 message 脱敏——workspace 测试断言的是 `err.code` 而非 message，不受影响；对自产消息（"path escapes workspace" 等）`safeErrorMessage` 幂等。未发现把正常业务错误内容误掩码的情况。
- **BUG-2 误伤可控**：`\bsk-` 词边界 + 8~40 字符窗口；工程师补充了反误伤断言（`'use sk-abc then continue'` 不掩码）。对 `task-/risk-/disk-` 等普通单词因词边界不命中。
- **BUG-4 无重复/排序退化**：`Set` 去重保证候选无重复；`searchCandidateIds` 返回无序候选后仍由 `local.ts` 精排打分，与修复前一致；工程师新增混合段用例（3 字段 trigram + 2 字段 LIKE 并集）通过。
- **残留已知边界（低危，不阻塞）**：`dangerous.ts` 的 `rm\b` 词边界对 `rm_rf` 仍不命中（工程师已在 mcp.test.ts 注释中说明）；`rmdir`/`rm`/`remove_*`/`delete_*` 均能覆盖，实际 MCP 工具名风险低。

## R2-2 全量 5 个失败——环境守卫，非代码回归

全量 `npm test`：200 用例 / 195 通过 / 5 失败，全部为同一模式：

| 失败项 | 文件 | 失败类型 |
|---|---|---|
| git: status rejects symlink-escape (realpath) | `tests/git.test.ts` | 测试 finally 清理 `fs.rmSync` 被守卫拦截 |
| texttools: search skips symlink-escape | `tests/texttools.test.ts` | 同上 |
| texttools: replace does not rewrite symlink-escape | `tests/texttools.test.ts` | 同上 |
| texttools: rename rejects symlink-escape | `tests/texttools.test.ts` | 同上 |
| workspace.test.ts（整个文件） | `tests/workspace.test.ts` | after-hook `fs.rmSync(root)` 被守卫拦截（`hookFailed`） |

**判定依据（环境守卫、非回归）**：
1. 失败堆栈全部在 `genie-safe-delete.cjs`（`SAFE_DELETE_BULK_REJECTED {"count":50,"threshold":50,"scope":"turn"}` → `rimrafSync` → `rmSync`），不经过任何应用代码/断言。
2. 失败的是**临时目录清理**（`finally`/`after` 钩子里的 `fs.rmSync`），不是测试断言；workspace 文件失败类型为 `hookFailed`。
3. 同一批测试在 Round 1 全量中 177/177 通过（当时守卫计数未耗尽）；本轮该守卫的 per-turn 删除预算（50）已被本会话多次全量/独立运行耗尽，导致后续任何 `rmSync` 被拒——git.test.ts **单独运行同样失败**佐证是会话级计数而非全量累积。
4. 失败用例的断言内容是 symlink-escape 的 400/200 行为，与 BUG-1 脱敏改动无关（其错误消息为自产消息，`safeErrorMessage` 幂等）。
5. 按主理人要求**未使用删除授权绕过**，避免打扰用户。

> 建议：在守卫阈值重置（新会话）后重跑 `npm test` 以确认 200/200；届时如仍失败再按代码缺陷处理。

## R2-3 工程师新增回归断言复核（全部通过）

- `tests/error-mask.test.ts` +3：`API key provided: sk-xxx`（空格分隔+短值）、`api_key=sk-` 短值（8~40 位）、反误伤（<8 位不掩码）。
- `tests/mcp.test.ts` +1：`rmdir`/`rm`/`write_file` 分类断言（含 `rm_rf` 已知边界注释）。
- `tests/memory.test.ts` +1：多段中文并集（2 字段 + 2 字段）、混合段（3 字段 trigram + 2 字段 LIKE）。

## R2-4 残余问题清单

1. **环境守卫 5 失败**（非代码）：见 R2-2，建议新会话重跑确认。
2. **`rm_rf` 词边界漏判**（低危，工程师已注释为已知边界）：`dangerous.ts` 的 `rm\b` 对下划线连接名不命中；若未来出现 `rm_rf` 命名的 MCP 工具需补 `rm_` 或改 `rm[_\b]`。
3. **前端鉴权收尾回归**：待前端工程师完成后另行分派（本报告仅覆盖后端 T01–T04）。

## R2-5 Round 2 智能路由判定

**NoOne（后端全过）** —— QA 独立 17/17、工程师回归断言全过、`tsc` 0 错误、修复质量审查无问题；全量 5 失败为环境守卫（非回归）。Round 2 完成，不进入 Round 3。

---

# Round 3 前端回归（T05 拆分 + R3/R4/R5 前端 + 鉴权收尾 · 最终前端验证）

> QA 工程师：严过关（Edward）· 日期：2026-08-25
> 范围：R1 拆分（chat/ 8 文件 + settings/ 6 文件）、R3 前端（axios 拦截器 / apiFetch / SSE / 401 提示）、R4 前端（GeneralSection 审批开关 + confirm）、R5 前端（McpPanel 白名单 UI）、鉴权收尾（7 面板 apiFetch 收敛）、i18n settings.approval.* 7 语言对齐。
> 方法：独立复跑 vitest + tsc；源码逐项审查（client.ts / apiConfig.ts / AgentChat.tsx / Settings.tsx / McpPanel.tsx / 7 面板）；grep 裸 fetch 与 axios 直连；i18n 键对齐核对；边界错误处理逐面板评估。

## R3-0 总览

| 项 | 结果 |
|---|---|
| `npx vitest run` | ✅ **17 文件 / 120 用例全绿**（拆分前基线 113 + 新增 chat 子组件单测 7） |
| `npx tsc -b` | ✅ **0 错误**（exit 0） |
| 拆分支质量（chat/ + settings/） | ✅ 行为/UI 一致；AgentChat.test.tsx 37 用例、Settings.test.tsx 2 用例原样通过 |
| App.tsx 零改动 | ✅ 源码核对一致（项目无 .git，无法 git diff，见 R3-2 备注） |
| 鉴权收尾 | ✅ 拦截器/apiFetch/SSE/401 提示符合设计；7 面板裸 fetch 收敛 apiFetch；裸 fetch 仅剩豁免位 |
| R4 前端 | ✅ GeneralSection 审批开关：读取 GET、关闭二次确认、POST `confirm:true`、busy 防抖、错误通知 |
| R5 前端 | ✅ McpPanel 白名单：GET `/api/mcp/:id/tools`、PUT `/api/mcp/:id` `{allowedTools}`、三色徽标、草稿保留 |
| i18n 门禁 | ✅ `settings.approval.*` 5 键 × 7 语言对齐；`keys.test.ts` 键奇偶校验通过（8 用例） |
| 发现的问题 | **1 中 / 4 低 / 2 信息**（均只记录不修改源码） |
| 智能路由判定 | **Send To: Engineer（FE-AUTH-1，2 行修复）**；其余为低危加固项，可并入后续迭代 |

## R3-1 测试结果（独立复跑）

```
npx vitest run  →  Test Files  17 passed (17) / Tests  120 passed (120)
npx tsc -b      →  exit 0（0 错误）
```

- 测试文件分布：`src/components/__tests__/`（AgentChat 37 / Settings 2 / Sidebar 3 / ContextUsageBar 5 / RagHelp 4 / TrajectoryDrawer 4 / MarkdownEditor 4 / FileTrackerPanel 6 / AnsiText 6）、`src/components/chat/__tests__/`（MessageRow 4 + ToolApprovalCard 3 = 新增 7）、`src/hooks/__tests__/`（useContextUsage 8 / useShortcuts 7 / useTTS 7）、`src/i18n/`（index 6 / keys 8）、`src/theme.test.ts`（6）。
- 拆分前 113 → 拆分后 120，增量恰好等于新增 7 个 chat 子组件单测；AgentChat/Settings 既有用例零改动通过，佐证拆分未破坏容器行为。

## R3-2 拆分支质量审查（R1）

- **chat/ 子组件（8 文件）**：ChatHeader（151 行，纯展示容器传入 props）、ChatMessageList（251 行，内含 memo 化 MessageRow + 虚拟滚动 + thinking + 审批卡）、ChatInput（108 行）、ChatSearchPanel（67 行）、ToolApprovalCard（47 行）、ToolsBadgePanel（48 行，独立文件满足设计 S7）、stats.tsx（LiveStats/ElapsedBadge 自 tick，68 行）、types.ts（StreamUsage/PendingApproval 契约）。注释均标注"原 AgentChat.tsx Lxxx 平移"，引用位置与设计文档 T05 表格一致。
- **settings/ 子组件（6 文件）**：ThemeSection / LanguageSection / GeneralSection / KnowledgeSection / PromptsSection / ShortcutsSection；各分区自带 state（themePref/accentColor/langPref/general/docs/prompts/ragConfig），localStorage 写入时机不变；Settings.tsx 瘦身为 125 行容器（sections 数组 + activeSection + renderContent 分发），`vi.mock('../../api/client')` 对子组件同模块生效，测试零改动通过 ✅
- **对外导出形态**：AgentChat.tsx / Settings.tsx 均保持**命名导出** `export function`；App.tsx 以 `import('./components/Settings').then(m => ({ default: m.Settings }))` lazy 引用 + 命名映射，`export default App` 不变 ✅
- **App.tsx 零改动核对**：项目根目录无 `.git`（仅有 `.git-test-*` 沙盒目录），无法执行 `git status/diff`。改为三重核对：(a) 设计文档 T05 明确"App.tsx L4/L71/L15 零改动"契约；(b) App.tsx 源码为基线形态（lazy 列表 + switch 分发 + Sidebar/AgentChat 直引，无任何对 `chat/`、`settings/` 子目录的直接引用）；(c) AgentChat/Settings 测试以原路径 `../AgentChat`、`../Settings` 引用并通过。**结论：零改动声明与源码一致（无 git 快照可 diff）**。

## R3-3 鉴权收尾审查（R3 + T01 联动）

| 项 | 位置 | 结论 |
|---|---|---|
| `getAgentApiKey()`（env VITE_AGENT_API_KEY 优先 → localStorage 回退） | `src/apiConfig.ts` L53-63 | ✅ 与设计一致 |
| axios 请求拦截器统一注入 Bearer | `src/api/client.ts` L41-45 | ✅ 所有 axios 调用自动带 Authorization |
| axios 响应拦截器：成功记 X-Request-Id / 401 打 AUTH_401_HINT / 失败附 requestId | `client.ts` L53-70 | ✅ `error.message` 追加 `(requestId: xxx)` |
| `AUTH_401_HINT` 可读提示 | `client.ts` L37-38 | ✅ 指向启动日志/`VITE_AGENT_API_KEY`/Settings |
| `apiFetch` 统一封装（Bearer + 401 warn） | `client.ts` L76-83 | ✅ |
| SSE `streamAgentEvents`（Bearer + 非 200 附 requestId + 空闲超时 + Abort 不泄漏） | `client.ts` L284-353 | ✅（含 401 分支见 FE-AUTH-2） |
| 7 面板裸 fetch 收敛 apiFetch | SkillsPanel / TerminalPanel / ComputerPanel / TasksPanel / WorkspacePanel / LLMFlameChart / ModelManager | ✅ 全部改用 apiFetch |
| 裸 `fetch(` 全局 grep | 仅剩：McpPanel（authHeaders 豁免）、AgentChat 审批流（authHeader 豁免）、client.ts 内部（apiFetch/SSE） | ✅ 无遗漏 |
| axios 直连 | 仅 `src/api/client.ts` L1（单点实例 + 拦截器） | ✅ |
| console 收敛 | 仅 test setup / ErrorBoundary / logger 自身 | ✅ |

**豁免位复核**：McpPanel `authHeaders()`（L37-44）、AgentChat `authHeader()`（L29-36）均带 Bearer，但见 **FE-AUTH-1**（只读 localStorage，不读 env key）。

## R3-4 R4 / R5 前端交互审查

**R4 GeneralSection（settings/GeneralSection.tsx）**：
- 挂载时 `agentApi.getApprovalRequired()`（GET `/api/agent/settings/approval`）读后端状态，cancelled 标志防竞态（L50-57）✅
- `toggleApproval(enabled)`：关闭（`!enabled`）先 `window.confirm(t('settings.approval.confirmDisable'))`，取消则 return；通过后 `agentApi.setApprovalRequired(enabled, !enabled)` → POST `{enabled, confirm:true}`（L59-74）✅ 与后端 AC-R4-2（无 confirm 关闭→400）契约一致
- `approvalBusy` 防双击；开关 `checked` 绑定后端返回状态，后端失败不翻转 ✅；错误经 `onNotify('error', err.response.data.error)` 可读展示 ✅
- 附加发现：ModelManager 亦存在一套审批开关（L185-205，同接口同确认框），与 GeneralSection 双入口——见 FE-DUP-1。

**R5 McpPanel 白名单（McpPanel.tsx）**：
- 展开"配置工具白名单"→ `GET /api/mcp/:id/tools` 拉取 `McpToolInfo[]`（allowed/dangerous/forcedApproval）（L72-84）✅
- 勾选草稿 `draftAllowed` 仅在首次初始化（`tools.filter(t => t.allowed)`，与后端 fail-closed 一致），未保存勾选不丢失（L79-82）✅
- 保存 → `PUT /api/mcp/:id` body `{allowedTools}`（L108-122）✅ 与后端 R5 契约一致
- 徽标：`dangerous`→红"危险"、`forcedApproval`→琥珀"强制审批"、`!allowed`→灰"拦截"（L307-315）✅
- 注意：勾选框 `checked` 取自草稿而非服务端 `allowed`——设计上允许"未保存先改"，保存后 `refresh()+loadTools` 回读 ✅

## R3-5 i18n 门禁

- `settings.approval.*` 5 键（title/desc/require/requireDesc/confirmDisable）在 en/ja/ko/zh-CN/zh-TW/bo/fa 全部对齐（grep 计数 5×7=35）✅
- `src/i18n/keys.test.ts` 以 en 为 source of truth 校验 6 语言键集完全一致 + 无 `\${}` 插值语法，8 用例通过 ✅
- 缺口：R5 白名单 UI 新增的提示文案为**硬编码中文**（见 FE-I18N-1），未进 i18n 键体系。

## R3-6 边界检查（apiFetch 非 JSON / 网络错误 / 401 面板行为）

| 面板 | 网络/非 JSON 错误 | 401 行为 | 结论 |
|---|---|---|---|
| ComputerPanel | try/catch → status error + 日志 | 显示 errConnect/unreachable | ✅ 可读 |
| TerminalPanel | try/catch → `Error: ${message}` | 终端内可读 | ✅ |
| WorkspacePanel | `!res.ok` 分支解析错误 JSON + throw，调用方 catch 展示 | 错误态可读 | ✅ |
| TasksPanel | catch → `loadError` 状态 + 重试按钮 | 错误态可读 | ✅ |
| ModelManager | `.catch(() => {})` 静默（审批读取/切换） | 仅 console warn | ⚠️ 静默但非崩溃（低） |
| LLMFlameChart | load 走 axios catch 展示 error；clear `catch ignore` | console warn | ✅ |
| SkillsPanel | `refresh()` try/**finally 无 catch** → 网络错误时 unhandled rejection + 空列表无提示 | 仅 console warn，UI 无提示 | ⚠️ 见 FE-ERR-1 |
| AgentChat SSE 401 | 非 200 throw（附 requestId），chat 气泡可见 | 无 AUTH_401_HINT 提示 | ⚠️ 见 FE-AUTH-2 |

`apiFetch` 本身对 401 一律 `logger.warn(AUTH_401_HINT)`（client.ts L81），console 层有兜底；UI 层可读性取决于各面板 catch（多数 ✅，SkillsPanel 例外）。

## R3-7 发现的问题清单（只记录，未修改源码）

### FE-AUTH-1 【中】审批/白名单裸 fetch 的 Bearer 只读 localStorage，不读 env key（鉴权收尾核心缺口）

- **位置**：`src/components/AgentChat.tsx` L29-36（`authHeader()`）、`src/components/McpPanel.tsx` L37-44（`authHeaders()`）
- **复现**：用户仅配置 `VITE_AGENT_API_KEY`（AUTH_401_HINT 推荐的 S4 默认方案，也是本地开发最常见做法）时：
  - AgentChat 审批流 `POST /api/agent/tools/approve`（L443/454）**不带 Authorization** → 401 → catch 静默吞掉后 `setPendingApproval(null)`——用户看到审批卡消失、以为已批准，实际后端未收到；
  - McpPanel 全部 fetch（connect/save/delete 等）401 → 连接/保存"看起来成功"，refresh 后回弹。
- **根因**：`getAgentApiKey()`（apiConfig.ts L53）是唯一统一来源（env 优先 + localStorage 回退）；axios 拦截器 / apiFetch / SSE 均走它，唯独这两个"豁免位"手写了只读 localStorage 的副本，与统一语义不一致。
- **建议**：两处 helper 改为 `import { getAgentApiKey } from '../apiConfig'` 后注入 `Bearer ${getAgentApiKey()}`（与 apiFetch 一致），2 行修复。
- **测试缺口**：AgentChat.test.tsx 审批用例只断言 method/body，未断言 Authorization 头，故未暴露（建议补断言：localStorage 有 key 时 header 存在；无 key 时 header 不存在）。

### FE-AUTH-2 【低】SSE 401 无 AUTH_401_HINT 提示

- **位置**：`src/api/client.ts` L304-308（`streamAgentEvents` 非 200 分支）
- **现象**：SSE 401 时仅 throw 原始错误文本（附 requestId），AgentChat 气泡显示 `Unauthorized (requestId: xxx)`，但没有 axios/apiFetch 路径的 `AUTH_401_HINT`（去哪拿 AGENT_API_KEY 的指引）。不算静默（用户能看到错误），但提示可操作性弱。
- **建议**：非 200 分支 `if (response.status === 401) logger.warn(AUTH_401_HINT);`（1 行）。

### FE-ERR-1 【低】SkillsPanel refresh() 无 catch，网络错误 unhandled rejection + 空列表无提示

- **位置**：`src/components/SkillsPanel.tsx` L39-45（`refresh()` 只有 try/finally）、L23-27（`getSkills()` `res.json()` 无兜底）
- **现象**：后端不可达或返回非 JSON（如 502 网关页）→ `res.json()` throw → refresh() reject → unhandled promise rejection；UI 静默显示空技能列表，无错误提示。其余 6 面板均有可读错误态。
- **建议**：`refresh()` 增加 catch → `setError(...)` 并在 UI 展示（参照 TasksPanel 的 loadError 模式）。

### FE-URL-1 【低】SkillsPanel / LLMFlameChart 的 apiFetch 未走 apiUrl()，Tauri/远程模式失效

- **位置**：`src/components/SkillsPanel.tsx` L24（`apiFetch(API)` 裸 `/api/skills`）、`src/components/LLMFlameChart.tsx` L61（裸 `/api/telemetry/llm-calls`）
- **现象**：浏览器/vite 模式经代理可用；但 Tauri/远程模式（`getApiBase()` 返回完整地址）下，裸相对路径会请求本地 origin 而非远程服务器 → 失败。其余面板（TasksPanel/TerminalPanel/ComputerPanel/ModelManager/WorkspacePanel）均 apiUrl/apiUrl2 包裹。
- **建议**：SkillsPanel L24 改 `apiFetch(skillsUrl(''))`；LLMFlameChart L61 改 `apiFetch(apiUrl('/api/telemetry/llm-calls...'))`。（系收敛时保留的既有 URL 形态，非本次回归引入。）

### FE-I18N-1 【低】R5 白名单 UI 硬编码中文，未走 i18n

- **位置**：`src/components/McpPanel.tsx` L291（'配置工具白名单'/'收起工具白名单'）、L308（'危险'）、L311（'强制审批'）、L314（'拦截'）、L330（'保存后需重连生效 · 未勾选工具对 LLM 不可见'）；另 `src/components/ModelManager.tsx` L195（关闭审批确认中文文案）
- **现象**：7 语言环境下这些新增/既有文案恒为中文；面板其余部分均用 `t('...')`。
- **建议**：新增 `mcp.*` 键 7 语言对齐后替换（keys.test.ts 会自动拦截缺键）。

### FE-COVER-1 【低】R3/R5 前端核心逻辑无直接单测

- **现象**：`src/api/client.ts`（拦截器 Bearer、apiFetch 401 hint、SSE Bearer + requestId）与 `src/components/McpPanel.tsx`（白名单勾选/保存）均无对应测试文件；当前仅靠 tsc + AgentChat 集成测试间接覆盖。
- **建议**：补 `client.test.ts`（mock axios/fetch 断言注入头与 requestId 追加）+ `McpPanel.test.tsx`（白名单勾选→PUT body 断言）。

### FE-DUP-1 【信息】审批开关双入口（GeneralSection 新增 vs ModelManager 既有）

- **位置**：`settings/GeneralSection.tsx` L189-212 与 `components/ModelManager.tsx` L185-205
- **说明**：两处均读写 `/api/agent/settings/approval`、均有关闭确认框，接口契约一致、不冲突；但同一设置两个 UI 入口易让用户困惑（改一处另一处下次挂载才刷新）。建议后续收敛到单一入口（非本轮阻塞项）。

## R3-8 智能路由判定

- **判定**：**Send To: Engineer（Alex）** —— 测试全绿、tsc 0 错误，但交付范围内存在 1 个**中危源码缺陷 FE-AUTH-1**（审批/白名单裸 fetch 对 `VITE_AGENT_API_KEY` 用户 401 静默失败，恰是推荐配置方式），修复量极小（2 处 helper 改用 `getAgentApiKey()`）。
- **建议**：Engineer 修复 FE-AUTH-1（顺手可含 FE-AUTH-2 一行 401 hint）后，QA 快速回归 `npx vitest run` + `npx tsc -b`（预计仍 120 全绿 + 0 错误）。其余 4 低（FE-ERR-1 / FE-URL-1 / FE-I18N-1 / FE-COVER-1）与 2 信息（FE-DUP-1）不阻塞，可并入后续迭代；若主理人决定本轮不返工，则 FE-AUTH-1 记为 Known Issue（env-key 用户审批/MCP 需改用 Settings 填 key 规避）。
- **Round 状态**：前端 Round 3（最终回归）完成——复跑全绿 + 六项审查完毕 + 问题记录完毕，未修改任何源码。
