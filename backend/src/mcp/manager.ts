/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from '../utils/logger.js';
import { toolRegistry } from '../tools/registry.js';
import { isDangerousToolName } from '../tools/dangerous.js';
import { mcpStore, type McpServerConfig } from './store.js';

export interface McpConnectionStatus {
  id: string;
  name: string;
  transport: string;
  connected: boolean;
  tools: { name: string; description: string }[];
  error?: string;
  autostart: boolean;
  reconnecting?: boolean;
  reconnectAttempts?: number;
  /** 配置的白名单（mcp__<server>__<tool>）；未配置 = fail-closed。 */
  allowedTools?: string[];
}

export interface McpToolInfo {
  name: string;
  description: string;
  allowed: boolean;
  dangerous: boolean;
  forcedApproval: boolean;
}

interface ActiveConnection {
  config: McpServerConfig;
  client: Client;
  toolNames: string[];
  /** 连接时发现的全部工具（含白名单外被拦截的，供面板展示）。 */
  tools: { name: string; description: string }[];
}

const TOOL_PREFIX = 'mcp__';

class McpManager {
  private connections: Map<string, ActiveConnection> = new Map();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts: Map<string, number> = new Map();
  private static readonly MAX_RECONNECT_ATTEMPTS = 10;
  private static readonly RECONNECT_INTERVAL_MS = 15_000;
  private static readonly INITIAL_BACKOFF_MS = 2_000;

  private async buildTransport(config: McpServerConfig) {
    if (config.transport === 'stdio') {
      return new StdioClientTransport({
        command: config.command || 'npx',
        args: config.args ? config.args.split(/\s+/).filter(Boolean) : [],
        env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
      });
    }
    const url = config.url || '';
    if (config.transport === 'sse') {
      return new SSEClientTransport(new URL(url));
    }
    // http (streamable)
    return new StreamableHTTPClientTransport(new URL(url));
  }

  private reconnecting: Set<string> = new Set();

  async connect(id: string): Promise<McpConnectionStatus> {
    const config = mcpStore.get(id);
    if (!config) return this.statusOf(id, false, [], `Server ${id} not found`);
    if (this.connections.has(id)) return this.statusOf(id, true, this.connections.get(id)!.toolNames);
    this.reconnecting.delete(id);

    const client = new Client({ name: 'ai-agent-app', version: '1.0.0' });
    try {
      const transport = await this.buildTransport(config);
      await client.connect(transport);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return this.statusOf(id, false, [], `Connection failed: ${message}`);
    }

    // Discover and register tools
    let toolList: { name: string; description: string; inputSchema?: unknown }[] = [];
    try {
      const res = await client.listTools();
      toolList = (res.tools || []) as { name: string; description: string; inputSchema?: unknown }[];
    } catch (err: unknown) {
      try { await client.close(); } catch { /* best-effort close */ }
      const message = err instanceof Error ? err.message : 'Unknown error';
      return this.statusOf(id, false, [], `Failed to list tools: ${message}`);
    }

    const toolNames: string[] = [];
    const discoveredTools: { name: string; description: string }[] = toolList.map((t) => ({
      name: t.name,
      description: t.description || t.name,
    }));
    // 白名单 fail-closed（决策 B）：未配置 allowedTools → 不注册任何工具（存量 6 条同样）。
    const allowedSet = new Set(config.allowedTools ?? []);
    for (const tool of toolList) {
      const registeredName = `${TOOL_PREFIX}${config.name}__${tool.name}`;
      if (allowedSet.size === 0) continue; // fail-closed：未配置白名单不暴露任何工具
      if (!allowedSet.has(registeredName)) continue; // 白名单外不注册（LLM schema 不可见）
      // 危险工具判定（名称启发式）：文件写/shell 执行类强制审批（AC-R5-3）
      const dangerous = isDangerousToolName(registeredName) || isDangerousToolName(tool.name);
      toolNames.push(registeredName);
      toolRegistry.register(registeredName, {
        schema: {
          name: registeredName,
          description: `[MCP:${config.name}] ${tool.description || tool.name}`,
          parameters: (tool.inputSchema as any)?.type
            ? (tool.inputSchema as any)
            : { type: 'object', properties: {}, required: [] },
        },
        handler: async (args: Record<string, unknown>) => {
          try {
            const result = await client.callTool({ name: tool.name, arguments: args || {} });
            const content = (result.content || []) as Array<{ type?: string; text?: string }>;
            const text = content
              .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
              .join('\n');
            return {
              success: !result.isError,
              output: text || '(no output)',
              data: result,
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return { success: false, output: `MCP tool error: ${message}`, error: message };
          }
        },
        category: 'mcp',
        requiresApproval: true,
        dangerous,
        enabled: true,
      });
    }

    this.connections.set(id, { config, client, toolNames, tools: discoveredTools });
    return this.statusOf(id, true, toolNames);
  }

  async disconnect(id: string): Promise<{ success: boolean; message: string }> {
    const conn = this.connections.get(id);
    if (!conn) return { success: true, message: 'Not connected' };
    for (const name of conn.toolNames) {
      toolRegistry.unregister(name);
    }
    try { await conn.client.close(); } catch { /* best-effort close */ }
    this.connections.delete(id);
    return { success: true, message: `Disconnected ${conn.config.name}` };
  }

  async disconnectAll(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) {
      await this.disconnect(id);
    }
  }

  /**
   * P4: Attempt to reconnect a previously disconnected server.
   * Returns false if max attempts exceeded.
   */
  async reconnect(id: string): Promise<boolean> {
    const config = mcpStore.get(id);
    if (!config || config.enabled === false) return false;
    if (this.connections.has(id)) return true;

    const attempts = (this.reconnectAttempts.get(id) || 0) + 1;
    if (attempts > McpManager.MAX_RECONNECT_ATTEMPTS) {
      logger.error(`[MCP] Reconnect abandoned for ${config.name} after ${attempts} attempts`);
      return false;
    }

    const backoffMs = Math.min(McpManager.INITIAL_BACKOFF_MS * 2 ** (attempts - 1), 60_000);
    logger.info(`[MCP] Reconnect attempt ${attempts}/${McpManager.MAX_RECONNECT_ATTEMPTS} for ${config.name} in ${backoffMs}ms`);
    this.reconnectAttempts.set(id, attempts);
    this.reconnecting.add(id);

    await new Promise(r => setTimeout(r, backoffMs));
    try {
      const ok = await this.connect(id);
      this.reconnecting.delete(id);
      this.reconnectAttempts.delete(id);
      logger.info(`[MCP] Reconnected ${config.name}`);
      return ok.connected;
    } catch {
      /* reconnect failure */
      return false;
    }
  }

  /**
   * Start periodic reconnection loop for autostart-enabled servers.
   */
  startReconnectLoop(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(async () => {
      const configs = mcpStore.list().filter(c => c.autostart && c.enabled !== false);
      for (const c of configs) {
        if (!this.connections.has(c.id)) {
          await this.reconnect(c.id).catch(() => {});
        }
      }
    }, McpManager.RECONNECT_INTERVAL_MS);
    logger.info('[MCP] Auto-reconnect loop started');
  }

  stopReconnectLoop(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  statusOf(id: string, connected: boolean, toolNames: string[] = [], error?: string): McpConnectionStatus {
    const config = mcpStore.get(id);
    const name = config?.name || id;
    const transport = config?.transport || 'unknown';
    const autostart = config?.autostart || false;
    const tools = toolNames.map(n => {
      const def = toolRegistry.get(n);
      return { name: n, description: def?.schema.description || n };
    });
    return {
      id, name, transport, connected, tools, error, autostart,
      reconnecting: this.reconnecting.has(id),
      reconnectAttempts: this.reconnectAttempts.get(id) || 0,
      allowedTools: config?.allowedTools ?? [],
    };
  }

  /** 是否已连接（PUT /:id 判断需提示重连）。 */
  isConnected(id: string): boolean {
    return this.connections.has(id);
  }

  /**
   * 返回已连接服务器的完整工具清单（含白名单外被拦截项），带 allowed/dangerous/forcedApproval 标记。
   * 未连接返回 undefined；fail-closed（未配置 allowedTools）时全部 allowed=false。
   */
  listTools(id: string): McpToolInfo[] | undefined {
    const conn = this.connections.get(id);
    if (!conn) return undefined;
    const allowedSet = new Set(conn.config.allowedTools ?? []);
    return conn.tools.map((t) => {
      const registeredName = `${TOOL_PREFIX}${conn.config.name}__${t.name}`;
      const dangerous = isDangerousToolName(registeredName) || isDangerousToolName(t.name);
      return {
        name: registeredName,
        description: t.description || t.name,
        allowed: allowedSet.has(registeredName),
        dangerous,
        // 危险工具即使全局审批关闭也强制审批（AC-R5-3）
        forcedApproval: dangerous,
      };
    });
  }

  listStatuses(): McpConnectionStatus[] {
    const configs = mcpStore.list();
    return configs.map(c => {
      const conn = this.connections.get(c.id);
      if (conn) return this.statusOf(c.id, true, conn.toolNames);
      return this.statusOf(c.id, false);
    });
  }

  async autostart(): Promise<void> {
    const configs = mcpStore.list().filter(c => c.autostart && c.enabled !== false);
    for (const c of configs) {
      try {
        await this.connect(c.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error(`[MCP] autostart failed for ${c.name}: ${message}`);
      }
    }
  }
}

export const mcpManager = new McpManager();
