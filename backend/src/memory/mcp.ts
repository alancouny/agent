// MCP 记忆 Provider — 经 MCP 协议读取第三方笔记（Obsidian / Notion 等）。
//
// MCP 工具在启动时由 mcpManager 并入 toolRegistry（统一注册表），本适配器
// 在 toolRegistry 中按命名规则发现"记忆类"工具并映射为 MemoryProvider：
//   search: 名称匹配 (search|find|query) 且含 (memory|note|obsidian|notion|brain|vault)
//   list / add / delete: 类似启发式（缺失则返回空/不可用）
// 工具名映射可用 mcpMemoryToolMap 显式覆盖（灵活可扩展）。
import { toolRegistry, executeTool } from '../tools/registry.js';
import type { MemoryEntry, MemoryProvider } from './types.js';

export interface McpMemoryToolMap {
  search?: string;
  list?: string;
  add?: string;
  delete?: string;
}

const MEMORY_HINTS = /memory|note|obsidian|notion|brain|vault|journal/i;
const SEARCH_HINTS = /search|find|query|retrieve/i;
const LIST_HINTS = /list|all|recent|files?/i;
const ADD_HINTS = /add|create|write|save/i;
const DELETE_HINTS = /delete|remove/i;

/** 从工具注册表发现记忆类 MCP 工具（registeredName 形如 mcp:serverName:toolName）。 */
function discoverTools(): { search?: string; list?: string; add?: string; delete?: string } {
  const names = toolRegistry
    .getAll()
    .map(([name, def]) => ({ name, desc: def?.schema?.description ?? '' }))
    .filter((x) => x.name.startsWith('mcp:') && MEMORY_HINTS.test(x.name + ' ' + x.desc));

  const pick = (re: RegExp) => {
    const hit = names.find((n) => re.test(n.name));
    if (hit) return hit.name;
    return names.find((n) => re.test(n.desc))?.name;
  };
  return {
    search: pick(SEARCH_HINTS),
    list: pick(LIST_HINTS),
    add: pick(ADD_HINTS),
    delete: pick(DELETE_HINTS),
  };
}

function parseEntries(raw: string, source: string): MemoryEntry[] {
  // 兼容常见输出：JSON 数组 / 每行一条
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x) => x && typeof x === 'object')
        .map((x: any, i: number) => ({
          id: String(x.id ?? x.path ?? `mcp-${source}-${i}`),
          content: String(x.content ?? x.text ?? x.body ?? x.path ?? JSON.stringify(x)).slice(0, 2000),
          tags: Array.isArray(x.tags) ? x.tags.map(String) : undefined,
          source,
          createdAt: x.createdAt ?? x.created ?? new Date().toISOString(),
          updatedAt: x.updatedAt ?? x.updated ?? x.createdAt ?? new Date().toISOString(),
        }));
    }
  } catch { /* not JSON */ }
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 50)
    .map((l, i) => ({
      id: `${source}-${i}`,
      content: l.slice(0, 2000),
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
}

/** 构造一个 MCP 记忆 provider（可显式指定工具映射；缺省每次调用时启发式发现，支持连接后生效）。 */
export function createMcpMemoryProvider(
  id: string,
  label: string,
  toolMap?: McpMemoryToolMap
): MemoryProvider {
  const kind = 'mcp' as const;
  // 延迟发现：MCP 工具可能在 provider 创建之后才注册（连接/重连），每次调用现查
  const toolsOf = (): McpMemoryToolMap => toolMap ?? discoverTools();

  return {
    id,
    kind,
    label,

    async isAvailable() {
      const t = toolsOf();
      return Boolean(toolRegistry.get(t.search ?? '') || toolRegistry.get(t.list ?? ''));
    },

    async list(limit = 100) {
      const t = toolsOf();
      const name = t.list || t.search;
      if (!name) return [];
      const r = await executeTool(name, { limit: Math.min(limit, 100) }, { sessionId: 'memory' });
      return r.success ? parseEntries(r.output, id).slice(0, limit) : [];
    },

    async get() {
      return null; // 第三方笔记一般不支持按 id 直取，走 search
    },

    async add({ content, tags }) {
      const name = toolsOf().add;
      if (!name) throw new Error(`MCP provider ${id} has no add tool mapped`);
      const r = await executeTool(name, { content, tags: tags ?? [] }, { sessionId: 'memory' });
      if (!r.success) throw new Error(`MCP add failed: ${r.error || r.output}`);
      return {
        id: `mcp-${id}-${Date.now()}`,
        content,
        tags,
        source: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    async update() {
      return null;
    },

    async remove(id) {
      const name = toolsOf().delete;
      if (!name) return false;
      const r = await executeTool(name, { id }, { sessionId: 'memory' });
      return r.success;
    },

    async search(query, topK) {
      const t = toolsOf();
      const name = t.search || t.list;
      if (!name) return [];
      const r = await executeTool(name, { query }, { sessionId: 'memory' });
      if (!r.success) return [];
      const entries = parseEntries(r.output, id);
      // 轻量排序：查询词重叠多的排前（MCP 侧可能已排序，这里做二次加权）
      const qTokens = query.toLowerCase().match(/[a-z0-9_\u4e00-\u9fff]+/g) ?? [];
      return entries
        .map((e) => {
          const overlap = qTokens.filter((t) => e.content.toLowerCase().includes(t)).length;
          return { ...e, score: overlap / Math.max(1, qTokens.length) };
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, Math.max(1, Math.min(topK, 20)));
    },
  };
}
