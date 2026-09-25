# AI Agent 桌面应用

多模态 AI Agent 桌面应用：React 19 + Vite 6 + Tailwind 4 前端，Express + TypeScript +
better-sqlite3 后端。内置 Agent 循环（DeepSeek-Harness 风格）、LangGraph 风格工作流引擎、
MCP 客户端、RAG 知识库（sqlite-vec 加速）、Skills、Tasks、语音、图像/视频生成等。

## 功能

| 模块 | 说明 |
|------|------|
| **Chat** | Agent 对话（ReAct 工具循环、Turn/Step 会话日志、审批门、并行只读工具、Steering、Trajectory 回放、文件追踪） |
| **工作流模式** | Chat 工具栏「工作流」开关 → LangGraph 风格 Supervisor StateGraph（router → supervisor/delegate → complete） |
| **Tasks** | Agent 自动拆解的多步任务看板 |
| **Terminal / Workspace** | 真实 shell 执行与文件浏览（也是 agent 的 `run_command` / `list_files` 工具） |
| **MCP Servers** | stdio / SSE / HTTP 三种传输，工具并入统一注册表，自动重连 |
| **Skills** | 可复用技能库，按用户意图关键词注入 |
| **Knowledge (RAG)** | 可配置 embedding/chunk/检索模式/rerank/索引后端（bruteforce 或 sqlite-vec 原生 KNN），异步灌入，embedding 版本化 |
| **Voice** | 文本转语音（TTS）+ 麦克风录音转文字（STT） |
| **Image / Video** | OpenAI 兼容生成端点 |
| **API** | 多模型 provider 管理、failover、对比 |
| **Theme** | 深色 / 浅色 / 跟随系统（默认跟随系统）+ 强调色，Settings → Theme |
| **多语言 (i18n)** | 英语（默认）/ 日本語 / 한국어 / 简体中文 / 繁體中文 / བོད་ཡིག / فارسی，Settings → Language 一键切换，波斯语自动 RTL |
| **全平台客户端** | Tauri v2：Windows / macOS / Linux 桌面端 + iOS / Android 移动端，同一套 React 代码；API 地址可切换（本地/远程），移动端抽屉导航 |

## 启动

```bash
# 前端（http://localhost:3000，代理 /api → :3001）
npm install
npm run dev

# 后端（http://localhost:3001）
cd backend && npm install && npm run dev

# 桌面客户端（Tauri，自动起前端；构建详见 docs/CLIENT_BUILD.md）
npx tauri dev
```

配置 LLM 提供商：`Settings → API`；RAG embedding 走 `EMBEDDING_BASE_URL/KEY/MODEL`（默认回退 `OPENAI_*`）。

### 快速开始

1. 克隆项目并安装依赖
   ```bash
   git clone <repo-url>
   cd agent
   npm install
   cd backend && npm install && cd ..
   ```
2. 配置环境变量 `.env`（复制 `.env.example`）：`OPENAI_API_KEY`、`EMBEDDING_*`
3. 启动后端：`cd backend && npm run dev`
4. 新开终端启动前端：`npm run dev`
5. 浏览器打开 http://localhost:3000，进入 Settings 配置模型，选择 Language/Theme
6. 在 Chat 面板发送首条消息，启用 Workflows 或 Tasks 体验 Agent 循环
7. Settings → Knowledge 导入文档，开启 RAG 检索

### 截图示例

- Chat 主界面：Agent 对话、Workflows 开关、Tasks 看板
- Settings 面板：API 配置、RAG 设置、Theme / Language 切换
- 截图持续完善中，参考 `docs/` 下的详细指南。

## 测试

```bash
# 后端（55 个：workflow/registry/routes/MCP fixture/workspace/terminal/RAG 矩阵/…）
cd backend && npm test

# 前端组件（17 个：Sidebar/RagHelp/FileTrackerPanel/TrajectoryDrawer）
npm run test:ui
```

构建：`npm run build`（前端 tsc + vite）；`cd backend && npm run build`（后端 tsc）。
桌面打包：Tauri v2 脚手架已就位（`src-tauri/`），需本机 Rust 工具链：`npm run tauri:dev`。

## 文档

- `docs/ARCHITECTURE.md` — 架构（agent 循环、Session Log、workflow 引擎、工具注册表、RAG…）
- `docs/TEST_REPORT.md` — 测试覆盖如实清单
- `docs/RAG_GUIDE.md` — 知识库（RAG）使用说明（Settings 里也有 ? 帮助面板）
- `docs/FEATURES.md` — 功能清单
