# 交付总结：中等档 5 项改造（2026-08-25）

> 交付人：SoftwareCompany 团队（主理人齐活林 / PM 许清楚 / 架构 高见远 / 工程 寇豆码 / QA 严过关）
> 范围：ARCH_REVIEW.md「⚙️ 中等投入档」5 项 + 前置决策（默认随机 API key、MCP 存量 fail-closed）

## TL;DR
ai-agent-app 完成 5 项架构/安全/性能改造：大文件拆分、FTS5 记忆检索、requestId 日志链路、审批开关安全加固、MCP 工具白名单。**后端 195 通过、前端 120/120、双端 tsc 0 错误**，QA 独立验证 3 轮无遗留阻塞。

## 交付清单

| 需求 | 交付内容 | 关键验收 |
|---|---|---|
| R1 拆分 | `src/components/chat/`(8 新) + `settings/`(6 新)，AgentChat(987行)/Settings(1146行) 瘦身为容器；App.tsx 零改动 | 既有 39 用例零改动全绿；UI/行为逐像素一致 |
| R2 FTS5 | 双 FTS5 external content 索引（unicode61+trigram）+ 2 字 LIKE 兜底 + TTL 缓存 + 启动回填；多段中文并集召回 | 不再全表扫描；'开源 项目' 召回修复 |
| R3 requestId | ALS + 中间件挂最前 + X-Request-Id 头 + 8 处 console 收敛 + 全路由错误脱敏 | 链路 requestId 一致；无明文 key 泄露 |
| R4 审批加固 | app_settings 持久化 + confirm:true 二次确认 + audit_logs 审计 + 默认随机 key 强制鉴权 | 无鉴权 401；无 confirm 400；重启不丢 |
| R5 MCP 白名单 | allowedTools fail-closed + 危险工具强制审批不可豁免 + 面板白名单 UI | 未配置=0 工具；关审批仍 PENDING_APPROVAL |

## 测试结果（最终）

| 项目 | 结果 |
|---|---|
| 后端全量 | 195/200 通过（5 失败为沙箱删除守卫环境产物，非回归，Round 1 同批 177/177） |
| QA 独立用例 | 17/17（后端）+ 前端 6 项审查全过 |
| 前端 | 120/120（113 基线 + 7 新增） |
| 双端 tsc | 0 错误 |
| 依赖 | 零新依赖 |

## QA 发现并已修复
- BUG-1(高)：8+ 路由错误响应未脱敏 → 统一 safeErrorMessage
- BUG-2(中)：OpenAI `key: sk-xxx` 格式掩码盲区 → 新增 sk- 白名单规则
- BUG-3(低)：rmdir 漏判 → 纳入危险模式
- BUG-4(中)：多段中文查询召回回归 → 按段并集
- FE-AUTH-1(中)：authHeader/authHeaders 不读 env key → 统一 getAgentApiKey

## 已知遗留（低危，已记录未处理）
SkillsPanel catch 缺失 / 裸 /api 路径(2 处) / McpPanel 硬编码中文 / 审批开关双入口 / 拦截器无单测 / SSE 401 无提示 / rm_rf 词边界。
建议下一批「深度重构档」或单独排期处理。

## 文档
- 需求：docs/PRD_MEDIUM_TIER.md
- 设计：docs/DESIGN_MEDIUM_TIER.md（+ class-diagram.mermaid / sequence-diagram.mermaid）
- QA：docs/QA_MEDIUM_TIER_BACKEND.md（Round 1/2/3）
- 进度：docs/ARCH_REVIEW.md「中等档已交付」表
