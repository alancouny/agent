/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { logger } from './utils/logger.js';
import { safeErrorMessage } from './utils/error-mask.js';
import { requestIdMiddleware } from './utils/request-context.js';
import { healthRouter } from './routes/health.ts';
import { ollamaRouter } from './routes/ollama.ts';
import { imageRouter } from './routes/image.ts';
import { videoRouter } from './routes/video.ts';
import { codeRouter } from './routes/code.ts';
import { modelProviderRouter } from './routes/model_provider.ts';
import { agentRouter } from './routes/agent.ts';
import { sessionRouter } from './routes/session.ts';
import { tasksRouter } from './routes/tasks.ts';
import { cpuRouter } from './routes/computer-use.ts';
import { mcpRouter } from './routes/mcp.ts';
import { terminalRouter } from './routes/terminal.ts';
import { workspaceRouter } from './routes/workspace.ts';
import { mcpManager } from './mcp/manager.ts';
import { skillsRouter } from './routes/skills.ts';
import { knowledgeRouter } from './routes/knowledge.ts';
import { promptsRouter } from './routes/prompts.ts';
import { voiceRouter } from './routes/voice.ts';
import { workflowRouter } from './routes/workflow.ts';
import { systemRouter } from './routes/system.ts';
import { gitRouter } from './routes/git.ts';
import { textToolsRouter } from './routes/texttools.ts';
import { pluginsRouter, loadPlugins } from './routes/plugins.ts';
import { experimentsRouter } from './routes/experiments.ts';
import { telemetryRouter } from './routes/telemetry.ts';
import { driftRouter } from './routes/drift.ts';
import { metacogRouter } from './routes/metacog.ts';
import { memoryRouter } from './routes/memory.ts';
import { localMemoryProvider } from './memory/local.js';
import { createMcpMemoryProvider } from './memory/mcp.js';
import { registerMemoryProvider } from './memory/registry.js';
import './memory/tools.js';
import { getDb, closeDb } from './db/database.js';
import { computerUseManager } from './computer-use/manager.js';

dotenv.config();

// ── 决策 A（R4 前置 #23）：默认强制鉴权 ─────────────────────────────
// 启动时无 AGENT_API_KEY 自动生成随机 key（每次启动变化），并在控制台醒目打印；
// auth 中间件无条件挂载，无鉴权请求一律 401（默认环境也成立）。
let API_KEY = '';
export function ensureApiKey(): string {
  if (API_KEY) return API_KEY;
  const envKey = process.env.AGENT_API_KEY?.trim();
  if (envKey) {
    API_KEY = envKey;
  } else {
    API_KEY = `agent-${randomBytes(24).toString('hex')}`;
    logger.warn(
      `\n==================================================\n` +
        `  AGENT_API_KEY: ${API_KEY}\n` +
        `  (ephemeral key generated at startup — set AGENT_API_KEY env var for a stable key)\n` +
        `==================================================`
    );
  }
  return API_KEY;
}
ensureApiKey(); // 启动即确定 key（authMiddleware 依赖它做比对）

export const app = express();
const PORT = process.env.PORT || 3001;

// ── requestId 中间件挂最前（rateLimit 之前，健康检查等免鉴权路由也覆盖）──
app.use(requestIdMiddleware);

// Rate limiting: 200 requests per 15 minutes per IP (relaxed for a local dev tool)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);
// API key auth — 无条件挂载（决策 A）：默认环境也强制鉴权，所有 /api/* 路由需 Bearer key。
// Health 和 CORS preflight 豁免；set AGENT_SKIP_AUTH_ROUTES 可加逗号分隔前缀（如 "/api/health,/api/voice"）。
const SKIP_AUTH = new Set(
  (process.env.AGENT_SKIP_AUTH_ROUTES || '/api/health').split(',').map(s => s.trim())
);

export const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === 'OPTIONS') return next();
  // 前缀豁免（如 /api/health、/api/voice）。注意：auth 挂在 /api 下时 req.path 是相对
  // 挂载点的（如 /health），需用 baseUrl+path 拼回完整路径才能匹配 SKIP_AUTH 前缀。
  const fullPath = `${req.baseUrl || ''}${req.path}`;
  const skipHit = Array.from(SKIP_AUTH).find((p) => fullPath === p || fullPath.startsWith(p + '/'));
  if (skipHit) return next();
  const key = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized: missing or invalid API key' });
};
app.use('/api', authMiddleware);

// ── CORS: 仅放行本地前端（vite dev / tauri webview）与无 Origin 的非浏览器客户端 ──
// 默认白名单覆盖 vite(3000)、tauri dev(1420)、tauri 生产协议；可用 CORS_ORIGINS 扩展。
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:1420,tauri://localhost,http://tauri.localhost'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize database
try {
  getDb();
  logger.info('Database initialized');
} catch (err) {
  logger.error('Database init error', err);
}

// Routes
app.use('/api/health', healthRouter);
app.use('/api/ollama', ollamaRouter);
app.use('/api/image', imageRouter);
app.use('/api/video', videoRouter);
app.use('/api/code', codeRouter);
app.use('/api/model', modelProviderRouter);
app.use('/api/agent', agentRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/computer-use', cpuRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/terminal', terminalRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/workflow', workflowRouter);
app.use('/api/system', systemRouter);
app.use('/api/git', gitRouter);
app.use('/api/texttools', textToolsRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/experiments', experimentsRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/drift', driftRouter);
app.use('/api/metacog', metacogRouter);
app.use('/api/memory', memoryRouter);

// ── Unified JSON error handler (must be last) ─────────────────────────────────
// 错误响应统一经 safeErrorMessage 脱敏（不泄露 api_key / Bearer token / 长密钥）。
export const errorHandler: express.ErrorRequestHandler = (
  _err: any,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  const status = _err.status || _err.statusCode || 500;
  res.status(status).json({ error: safeErrorMessage(_err.message || 'Internal server error') });
};
app.use(errorHandler);

// 仅监听本机回环：本地工具不应暴露到局域网（防止远程任意调用 /terminal、/workspace 等）
const HOST = process.env.HOST || '127.0.0.1';

// 仅直接运行（tsx src/server.ts / npm start）时监听；被测试 import 时不启动端口。
const isMainModule =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  app.listen(Number(PORT), HOST, () => {
    logger.info(`AI Agent Backend running on http://${HOST}:${PORT}`);
    // Auto-connect MCP servers flagged autostart (non-blocking)
    mcpManager.autostart().catch(err => logger.error('MCP autostart error', err));
    // 全局长期记忆：内置 local + 自动发现已连接 MCP 笔记工具
    registerMemoryProvider(localMemoryProvider);
    registerMemoryProvider(createMcpMemoryProvider('mcp:notes', 'MCP Notes (Obsidian/Notion)'));

    // Load plugins from backend/plugins/*.js (non-blocking)
    loadPlugins()
      .then((plugins) => logger.info(`[plugins] loaded ${plugins.length} plugin(s)`))
      .catch((err) => logger.error('[plugins] load error', err));
    // P4: start auto-reconnect for MCP servers
    mcpManager.startReconnectLoop();

    // Graceful shutdown: stop MCP reconnect loop, disconnect MCP/computer-use subprocesses, close DB
    function shutdown() {
      logger.info('Shutting down...');
      mcpManager.stopReconnectLoop();
      mcpManager.disconnectAll().catch(() => {});
      try {
        computerUseManager.stopServer();
      } catch { /* best-effort */ }
      closeDb();
      process.exit(0);
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}