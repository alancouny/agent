import { Router, Request, Response } from 'express';
import { mcpStore, type McpServerConfig } from '../mcp/store.js';
import { mcpManager } from '../mcp/manager.js';
import { assertSafeCommand } from '../utils/safeCommand.js';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';

export const mcpRouter = Router();

/** allowedTools 校验：string[]，元素为非空字符串（S6：POST 与 PUT 同校验）。 */
function isAllowedToolsArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim().length > 0);
}

// List configured servers with live status
mcpRouter.get('/', (_req: Request, res: Response) => {
  const servers = mcpManager.listStatuses();
  res.json({ servers, count: servers.length });
});

// Add a new server config
mcpRouter.post('/', (req: Request, res: Response) => {
  const { name, transport, command, args, url, env, autostart, allowedTools } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!['stdio', 'sse', 'http'].includes(transport)) {
    return res.status(400).json({ error: 'transport must be stdio | sse | http' });
  }
  if (transport === 'stdio' && !command) {
    return res.status(400).json({ error: 'command is required for stdio transport' });
  }
  if (transport === 'stdio') {
    try {
      assertSafeCommand(String(command));
    } catch (e: unknown) {
      logError(logger, 'mcp:config-validate', e);
      // 错误响应体脱敏（AC-R3-2）
      return res.status(400).json({ error: safeErrorMessage(e) });
    }
  }
  if ((transport === 'sse' || transport === 'http') && !url) {
    return res.status(400).json({ error: 'url is required for sse/http transport' });
  }
  if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env))) {
    return res.status(400).json({ error: 'env must be an object' });
  }
  if (allowedTools !== undefined && !isAllowedToolsArray(allowedTools)) {
    return res.status(400).json({ error: 'allowedTools must be a non-empty string array' });
  }
  const existing = mcpStore.getByName(name);
  if (existing) return res.status(409).json({ error: `Server "${name}" already exists` });

  const server = mcpStore.add({
    name,
    transport,
    command,
    args,
    url,
    env,
    autostart: !!autostart,
    enabled: true,
    allowedTools,
  });
  res.status(201).json({ server });
});

// Update a server config（allowedTools/autostart/enabled；已连接时提示需重连生效，S5）
mcpRouter.put('/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const config = mcpStore.get(id);
  if (!config) return res.status(404).json({ error: 'Server not found' });
  const { allowedTools, autostart, enabled } = req.body || {};
  const patch: Partial<McpServerConfig> = {};
  if (allowedTools !== undefined) {
    if (!isAllowedToolsArray(allowedTools)) {
      return res.status(400).json({ error: 'allowedTools must be a non-empty string array' });
    }
    patch.allowedTools = allowedTools;
  }
  if (autostart !== undefined) {
    if (typeof autostart !== 'boolean') return res.status(400).json({ error: 'autostart must be a boolean' });
    patch.autostart = autostart;
  }
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    patch.enabled = enabled;
  }
  const updated = mcpStore.update(id, patch);
  const connected = mcpManager.isConnected(id);
  res.json({
    server: updated,
    connected,
    note: connected ? 'Server is connected — reconnect to apply allowedTools changes' : undefined,
  });
});

// Connect (and register tools)
mcpRouter.post('/:id/connect', async (req: Request, res: Response) => {
  const status = await mcpManager.connect(String(req.params.id));
  if (!status.connected) return res.status(502).json({ status });
  res.json({ status });
});

// Disconnect (and unregister tools)
mcpRouter.post('/:id/disconnect', async (req: Request, res: Response) => {
  const result = await mcpManager.disconnect(String(req.params.id));
  res.json(result);
});

// Manual reconnect trigger
mcpRouter.post('/:id/reconnect', async (req: Request, res: Response) => {
  const status = await mcpManager.reconnect(String(req.params.id));
  const fullStatus = mcpManager.listStatuses().find(s => s.id === String(req.params.id));
  res.json({ status, fullStatus });
});

// List tools of a server（增强：每个工具附 allowed/dangerous/forcedApproval 标记）
mcpRouter.get('/:id/tools', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const config = mcpStore.get(id);
  if (!config) return res.status(404).json({ error: 'Server not found' });
  const tools = mcpManager.listTools(id) ?? [];
  res.json({ tools, count: tools.length });
});

// Delete a server config
mcpRouter.delete('/:id', async (req: Request, res: Response) => {
  await mcpManager.disconnect(String(req.params.id));
  const ok = mcpStore.remove(String(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Server not found' });
  res.json({ ok: true });
});
