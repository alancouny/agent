// 长期记忆工具 — Agent 可主动检索（memory_search）与沉淀（memory_save）。
// 内部走 active provider（local + 已激活的 MCP 源），
// 这是"Agent 自带全局长期记忆功能"的工具面接口。
import { toolRegistry } from '../tools/registry.js';
import { searchAllMemories, getMemoryProvider } from '../memory/registry.js';

toolRegistry.register('memory_search', {
  schema: {
    name: 'memory_search',
    description:
      'Search the agent\'s long-term memory (across all active sources: built-in + connected note tools like Obsidian/Notion). Use when the user references something from an earlier session, personal facts, or project notes. Returns ranked matches with scores.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  handler: async ({ query, topK }: { query?: string; topK?: number }) => {
    if (!query || !String(query).trim()) {
      return { success: false, output: 'query is required', error: 'QUERY_REQUIRED' };
    }
    const results = await searchAllMemories(String(query), Math.min(Number(topK) || 5, 10));
    if (!results.length) {
      return { success: true, output: 'No memories found. Reply normally; you may suggest saving important facts with memory_save.' };
    }
    const lines = results.map(
      (m, i) => `[${i + 1}] (${m.providerId}, score ${(m.score ?? 0).toFixed(3)}${m.tags?.length ? `, tags: ${m.tags.join(',')}` : ''})\n${m.content}`
    );
    return { success: true, output: lines.join('\n\n'), data: results };
  },
  category: 'memory',
  requiresApproval: false,
  enabled: true,
  readOnly: true,
});

toolRegistry.register('memory_save', {
  schema: {
    name: 'memory_save',
    description:
      'Save a fact into the agent\'s long-term memory (persists across sessions). Use for stable user preferences, project decisions, identity details — things worth remembering later. Optional tags help retrieval.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact / preference to remember. Write it as a concise, self-contained statement.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags, e.g. ["preference", "project:acs"]',
        },
      },
      required: ['content'],
    },
  },
  handler: async ({ content, tags }: { content?: string; tags?: string[] }) => {
    if (!content || !String(content).trim()) {
      return { success: false, output: 'content is required', error: 'CONTENT_REQUIRED' };
    }
    try {
      const p = getMemoryProvider('local');
      if (!p) return { success: false, output: 'memory unavailable', error: 'NO_PROVIDER' };
      const entry = await p.add({ content: String(content).trim(), tags: Array.isArray(tags) ? tags.map(String) : undefined });
      return { success: true, output: `Saved to long-term memory (${entry.id}).`, data: entry };
    } catch (e: any) {
      return { success: false, output: `memory_save failed: ${e.message}`, error: e.message };
    }
  },
  category: 'memory',
  requiresApproval: false,
  enabled: true,
});
