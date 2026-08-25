// ============================================================
// Plugin loader — 标准插件接口。
//
// 插件约定（backend/plugins/*.js，ESM）：
//   export default {
//     name: 'my-plugin',                 // 必填，唯一
//     description: '...',                // 必填
//     commands: {                        // 可选：暴露给终端/面板的命令
//       'hello': async (args: string[]) => ({ ok: true, output: '...' }),
//     },
//     hooks: {                           // 可选：挂到 agent 生命周期
//       beforeModelCall: async (ctx) => ctx,
//     },
//   }
//
// 插件命令可通过 POST /api/plugins/run 调用；钩子由 agent 执行时调用。
// ============================================================

import { Router } from 'express';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, '..', '..', 'plugins');

export interface PluginCommand {
  (args: string[], ctx: { cwd: string }): Promise<{ ok: boolean; output: string }> | { ok: boolean; output: string };
}

export interface AgentPlugin {
  name: string;
  description: string;
  version?: string;
  commands?: Record<string, PluginCommand>;
  hooks?: {
    beforeModelCall?: (ctx: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  };
}

const loaded = new Map<string, AgentPlugin>();

/** 加载 plugins/ 下的所有 .js 插件（启动时与 POST /reload 时调用）。 */
export async function loadPlugins(): Promise<AgentPlugin[]> {
  let files: string[] = [];
  try {
    files = (await readdir(PLUGINS_DIR)).filter((f) => f.endsWith('.js'));
  } catch {
    return []; // plugins 目录不存在时为空
  }
  for (const f of files) {
    try {
      const url = pathToFileURL(join(PLUGINS_DIR, f)).href;
      const mod = await import(`${url}?t=${Date.now()}`) as Record<string, unknown>;
      const plugin = ((mod.default as AgentPlugin | undefined) || (mod as unknown as AgentPlugin));
      if (!plugin?.name || typeof plugin.name !== 'string') continue;
      if (plugin.name && !/^[a-zA-Z0-9_-]{1,64}$/.test(plugin.name)) continue;
      loaded.set(plugin.name, plugin);
    } catch (e: unknown) {
      logError(logger, 'plugins:load', e);
      logger.error(`[plugins] failed to load ${f}:`, (e as { message?: string }).message);
    }
  }
  return [...loaded.values()];
}

export const pluginsRouter = Router();

pluginsRouter.get('/', async (_req, res) => {
  const plugins = [...loaded.values()].map((p) => ({
    name: p.name,
    description: p.description,
    version: p.version,
    commands: Object.keys(p.commands || {}),
    hooks: Object.keys(p.hooks || {}),
  }));
  res.json({ plugins, count: plugins.length, dir: PLUGINS_DIR });
});

pluginsRouter.post('/reload', async (_req, res) => {
  // 清空已加载引用再重载（ESM 动态 import 带时间戳避免缓存）
  for (const key of [...loaded.keys()]) loaded.delete(key);
  const plugins = await loadPlugins();
  res.json({ ok: true, count: plugins.length });
});

/** 运行插件命令：POST { plugin, command, args, cwd } */
pluginsRouter.post('/run', async (req, res) => {
  const { plugin, command, args = [], cwd } = req.body || {};
  const p = loaded.get(plugin);
  if (!p) return res.status(404).json({ error: `plugin not found: ${plugin}` });
  const fn = p.commands?.[command];
  if (!fn) return res.status(404).json({ error: `command not found: ${plugin}.${command}` });
  try {
    const result = await fn(Array.isArray(args) ? args.map(String) : [], { cwd: typeof cwd === 'string' ? cwd : process.cwd() });
    res.json({ plugin, command, ...result });
  } catch (e: unknown) {
    logError(logger, 'plugins:run', e);
    res.status(500).json({ error: (e as { message?: string }).message || 'plugin command failed' });
  }
});
