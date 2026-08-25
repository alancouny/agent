# 极客功能模块 — 设计与实现

> 一批功能性强、可玩性高、极具极客风格的功能模块。设计原则：
> **零重型依赖**（自绘 SVG/自写解析器，仅新增 markdown-it）、**复用既有模式**（lazy 面板 / 路由 / i18n 对齐门禁）、**安全边界内最大化**（git/texttools 限定项目根，插件仅运行显式命令）。

---

## 1. 可交互终端 CLI（增强 `TerminalPanel`）

**设计思路**：终端是极客的家的门面。在原有"命令 → 后端 zsh 执行"基础上，叠加三层能力：
- **本地即时内置命令**（`help/clear/echo/date/sysinfo/fortune/alias`）——不经过网络，毫秒响应，`sysinfo` 直接调 `/api/system/stats` 渲染系统快照；
- **历史与补全**——↑↓ 遍历执行历史、Tab 自动补全（内置命令 + 插件命令 + 历史首词）；
- **ANSI 彩色渲染**——后端输出可能含转义序列，统一经 `AnsiText` 渲染为彩色。

**实现要点**：`BUILTINS` 表（action → 函数）在执行链最前端拦截；`cmdHistory` state + `histIdxRef` 管理 ↑↓；`AnsiText` 把 SGR 码解析为 style token 再映射 `<span>`（支持 16/256/真彩色 + 粗斜下划线反显）。

**技术选型**：零依赖（ANSI 解析自写约 80 行）；`fetch` 直连保持与既有 terminal.execute 一致。

**交互细节**：`$` 提示符 + 时间戳；成功绿/失败红 + `exit 1` 徽标；悬停出现复制按钮；标题栏红黄绿三灯。

## 2. 实时系统监控仪表盘（`SystemMonitor`）

**设计思路**：把"机器在做什么"可视化——环形仪表（CPU/内存）+ 迷你曲线（CPU/内存/网络速率）+ 主机信息栏，2s 轮询 LIVE 刷新。

**实现要点**：
- 后端 `GET /api/system/stats`：CPU 用**两次采样差值**（`os.cpus()` 空闲时间比，跨平台）；网络按平台读累计字节（Linux `/proc/net/dev`、macOS `netstat -ib`）再做差分得速率；1s 内请求返回缓存防采样抖动；
- 前端 `Sparkline`（SVG polyline + 渐变面积 + 峰值标注）与 `MetricRing`（SVG circle dasharray 环形进度，带 glow）均为**零依赖自绘**；120 点滑动窗口 ≈ 4 分钟曲线。

**技术选型**：`node:os` + `execFile`，不引入 systeminformation。

**交互细节**：颜色分级（<50% 绿 / <80% 黄 / ≥80% 红）；Pause/Resume 冻结采样；网络面板显示实时 ↓↑ 速率与累计量；无网络权限平台友好提示。

## 3. 自动化 Git 工作流（`GitPanel`）

**设计思路**：把高频 git 操作变成面板——状态概览（分支 + 变更清单 + 暂存标记）、一键提交（可选 add -A）、分支创建/切换、提交历史、点击文件看 diff。

**实现要点**：后端 `gitRouter` 全部经 `execFile('git', [...args])` **不经 shell**（参数注入免疫）；`status` 用 `--porcelain` 解析为结构化变更；commit/branch 名校验正则；非仓库目录返回友好标记（`notRepository: true`）。**安全边界**：仅允许操作项目根（`backend/` 的父目录）内部。

**技术选型**：`child_process.execFile` + `--no-color` diff；前端 diff 经 `AnsiText` 着色。

**交互细节**：变更条目显示状态字母（M/A/D/R/? 着色 + staged 徽标）；Commit 输入框 Enter 直达；分支行悬停出现 checkout；日志为时间线风格（发光圆点 + 短哈希 + 主题）。

## 4. 文本处理工具（`TextTools`）

**设计思路**：正则驱动的工作台——跨仓库搜索、批量替换（**必须干跑预览再执行**）、批量重命名，全部限制在项目根内。

**实现要点**：
- 后端 `POST /texttools/search`：递归 `walkFiles`（跳过 node_modules/.git/dist 等，3000 文件/500 匹配上限），逐行正则匹配返回 `file:line:text`；
- `POST /texttools/replace`：`dryRun` 返回每文件匹配数与首例替换前后对照；执行时**原子写**（temp+rename）+ 大小上限；
- `POST /texttools/rename`：新名禁止路径分隔符，`withinRoot` 校验；
- 前端三段式 UI：搜索（结果表）、替换（干跑预览 → 红色 Apply 二次确认）、重命名（动态行编辑）。

**技术选型**：`node:fs/promises`；正则由用户输入（不转义），配合大小写开关。

**交互细节**：搜索命中行号琥珀色右对齐；替换预览"删除线旧行 → 绿色新行"；重命名支持任意行数增删。

## 5. 可扩展插件系统（`PluginsPanel` + `backend/plugins/`）

**设计思路**：零框架的标准插件接口——放一个 `.js` 进 `backend/plugins/` 即被加载，可暴露**命令**（供面板/终端调用）与**钩子**（挂 agent 生命周期）。

**接口契约**：
```js
export default {
  name: 'my-plugin',              // 唯一
  description: '...',
  commands: {                     // 面板/终端可调
    hello: async (args, { cwd }) => ({ ok: true, output: `hi ${args.join(' ')}` }),
  },
  hooks: { beforeModelCall: async (ctx) => ctx },
};
```

**实现要点**：启动时 + `/api/plugins/reload` 动态 `import()`（带时间戳防缓存）加载目录内全部 `.js`；`plugins/package.json {"type":"module"}` 保证 ESM；命令运行有插件/命令存在性校验。

**技术选型**：原生 ESM 动态导入，零框架；前端提供"命令执行台"（`plugin.command args`）+ 一键示例（点击命令 chip 自动填入）+ 内联接口文档。

**交互细节**：命令 chips 可点击回填执行台；hooks 以 `hook:` 徽标区分；执行结果 ANSI 渲染；示例插件 `geek-demo` 提供 fortune/fib/ascii/cointoss 四个可玩命令。

## 6. 可配置快捷键系统（`useShortcuts` + Settings）

**设计思路**：全局面板跳转快捷键，用户可改、可检测冲突。

**实现要点**：`useShortcuts` hook 全局 keydown 监听（输入框/文本域自动豁免）；`eventToKey` 把事件规范化为 `mod+shift+m` 组合键字符串；绑定存 localStorage；`findConflicts` 纯函数检测同键多动作。Settings 新增 Shortcuts 区块：点击绑定按钮进入**录制模式**（按组合键即写入，esc 取消），冲突行红色高亮 + 警示，一键重置默认。

**技术选型**：原生 KeyboardEvent + localStorage，零依赖。

**交互细节**：默认 `⌘/Ctrl+Shift+{H,M,G,T,P,K,`}` 覆盖主要面板；录制中按钮脉冲提示"press keys…"；键名格式化为 ⌘⌃⌥⇧ 符号。

## 7. 极客主题与 ANSI 彩色输出（`theme.ts` + `index.css`）

**设计思路**：在既有 light/dark/system 之上新增 5 套极客主题——**Matrix**（黑底绿字）、**Cyberpunk**（霓虹粉×电光青）、**Dracula**、**Monokai**、**Solarized Dark**。

**实现要点**：`GEEK_THEMES` 常量 + `ThemePreference` 联合扩展；`resolveTheme` 对极客主题原样透传，`data-theme` 直接写主题名；CSS 变量按 `:root[data-theme='x']` 整站换肤（Tailwind v4 变量体系天然支持）；Settings 主题卡片网格扩充 8 项（含色板预览）；`AnsiText` 复用为终端/插件/diff 的统一彩色输出通道。

**技术选型**：纯 CSS 变量，零依赖。

**交互细节**：每个主题卡片显示三色 swatch；切换即时生效且持久化；ANSI 组件对无转义文本降级为纯 pre 避免开销。

## 8. Markdown 实时预览与导出（`MarkdownEditor`）

**设计思路**：Split 模式边写边预览的 Markdown 工作室，极客渲染样式（霓虹标题/代码块/表格斑马纹），一键导出 HTML 或 PDF。

**实现要点**：`markdown-it`（唯一新增依赖，纯 JS 无原生模块）+ 自定义 `highlight`（HTML 转义 + 极客代码块样式）；草稿 `localStorage` 自动保存；导出 HTML 用内嵌样式的独立文档（Blob 下载）；导出 PDF 走 `window.print()` 打印视图（零依赖）。预览区使用 `.geek-md` 主题化样式（CSS 变量驱动，随主题换肤）。

**技术选型**：`markdown-it` + `@types/markdown-it`；`html:false` 防注入。

**交互细节**：edit/split/preview 三模式；导出按钮 `.html`/`.pdf` 分离；`dangerouslySetInnerHTML` 仅用于 markdown 渲染结果（非用户 HTML 直通）。

---

## 集成面

| 层 | 改动 |
| --- | --- |
| `TabType` | +`monitor/git/texttools/plugins/markdown` |
| `Sidebar` | +5 导航项（Activity/GitBranch/Replace/Blocks/FileText） |
| `App.tsx` | +5 lazy 面板 + 全局快捷键接线 |
| `api/client.ts` | +`systemApi/gitApi/textToolsApi/pluginsApi` |
| 后端路由 | +`system.ts/git.ts/texttools.ts/plugins.ts`（server.ts 注册 + 启动加载插件） |
| i18n | +6 组键 ×7 语言（对齐门禁 8/8 通过） |
| 测试 | 前端 96/96、后端 84/84 保持全绿 |

## 安全边界说明

- git/texttools 仅限**项目根内部**（`backend/` 父目录），绝对路径逃逸被拒；
- git 全程 `execFile` 不经 shell；commit/branch 名校验正则；
- 插件仅运行**显式注册**的命令（`/api/plugins/run` 校验存在性），不执行任意代码；
- markdown 渲染 `html:false`；终端命令仍走既有 sandbox 通道；
- texttools 替换/重命名均有路径校验 + 原子写。
