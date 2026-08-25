import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { atomicWriteJson, readJson } from '../shared/json-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const STORE_FILE = join(DATA_DIR, 'mcp_servers.json');

export type McpTransport = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string;
  url?: string;
  env?: Record<string, string>;
  autostart?: boolean;
  enabled?: boolean;
  /** 允许暴露给 LLM 的工具白名单（mcp__<server>__<tool> 全名）；缺失 = fail-closed（不暴露任何工具）。 */
  allowedTools?: string[];
  createdAt: string;
}

function ensureStore(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_FILE)) {
    const seed: McpServerConfig[] = [
      {
        id: 'mcp-memory',
        name: 'Memory',
        transport: 'stdio',
        command: 'npx',
        args: '-y @modelcontextprotocol/server-memory',
        autostart: false,
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ];
    atomicWriteJson(STORE_FILE, seed);
  }
}

function readAll(): McpServerConfig[] {
  ensureStore();
  // 解析失败告警而非静默返回 []
  return readJson<McpServerConfig[]>(STORE_FILE) ?? [];
}

function writeAll(list: McpServerConfig[]): void {
  ensureStore();
  atomicWriteJson(STORE_FILE, list);
}

export const mcpStore = {
  list(): McpServerConfig[] {
    return readAll();
  },

  get(id: string): McpServerConfig | undefined {
    return readAll().find(s => s.id === id);
  },

  getByName(name: string): McpServerConfig | undefined {
    return readAll().find(s => s.name === name);
  },

  add(config: Omit<McpServerConfig, 'id' | 'createdAt'>): McpServerConfig {
    const list = readAll();
    const entry: McpServerConfig = {
      ...config,
      id: `mcp-${uuidv4().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };
    list.push(entry);
    writeAll(list);
    return entry;
  },

  update(id: string, patch: Partial<McpServerConfig>): McpServerConfig | undefined {
    const list = readAll();
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return undefined;
    list[idx] = { ...list[idx], ...patch };
    writeAll(list);
    return list[idx];
  },

  remove(id: string): boolean {
    const list = readAll();
    const next = list.filter(s => s.id !== id);
    if (next.length === list.length) return false;
    writeAll(next);
    return true;
  },
};
