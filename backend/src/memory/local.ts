// 内置全局长期记忆（SQLite）。检索：FTS5 预筛（LIMIT）→ 复用关键词重叠评分精排 + TTL 缓存。
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';
import {
  searchCandidateIds,
  invalidateMemoryCache,
  getCachedSearch,
  putCachedSearch,
  SEARCH_LIMIT,
} from './fts.js';
import type { MemoryEntry, MemoryProvider } from './types.js';

/** 简易 tokenize：中英文按字符/单词切分（与 knowledge 的 BM25 风格一致）。 */
function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const chars = text.toLowerCase().match(/[\u4e00-\u9fff]/g) ?? [];
  return [...words, ...chars];
}

/** 关键词重叠 + 字符 n-gram 评分（轻量、无 embedding 依赖）。 */
function score(queryTokens: string[], contentTokens: string[]): number {
  if (!queryTokens.length || !contentTokens.length) return 0;
  const qSet = new Set(queryTokens);
  let overlap = 0;
  for (const t of contentTokens) if (qSet.has(t)) overlap++;
  return overlap / Math.sqrt(contentTokens.length) || 0;
}

function rowToEntry(r: any): MemoryEntry {
  let tags: string[] = [];
  try { tags = r.tags ? JSON.parse(r.tags) : []; } catch { tags = []; }
  return {
    id: r.id,
    content: r.content,
    tags,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const localMemoryProvider: MemoryProvider = {
  id: 'local',
  kind: 'local',
  label: 'Built-in Memory',

  async isAvailable() {
    return true;
  },

  async list(limit = 200) {
    const rows = getDb()
      .prepare('SELECT * FROM global_memories ORDER BY updated_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 1000))) as any[];
    return rows.map(rowToEntry);
  },

  async get(id) {
    const row = getDb().prepare('SELECT * FROM global_memories WHERE id = ?').get(id);
    return row ? rowToEntry(row) : null;
  },

  async add({ content, tags }) {
    if (!content || !content.trim()) throw new Error('content is required');
    const id = `mem-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare('INSERT INTO global_memories (id, content, tags, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, content, JSON.stringify(tags ?? []), 'local', now, now);
    invalidateMemoryCache();
    return { id, content, tags: tags ?? [], source: 'local', createdAt: now, updatedAt: now };
  },

  async update(id, patch) {
    const row = getDb().prepare('SELECT * FROM global_memories WHERE id = ?').get(id) as any;
    if (!row) return null;
    const content = patch.content ?? row.content;
    const tags = patch.tags !== undefined ? patch.tags : JSON.parse(row.tags || '[]');
    const now = new Date().toISOString();
    getDb()
      .prepare('UPDATE global_memories SET content = ?, tags = ?, updated_at = ? WHERE id = ?')
      .run(content, JSON.stringify(tags), now, id);
    invalidateMemoryCache();
    return { id, content, tags, source: row.source, createdAt: row.created_at, updatedAt: now };
  },

  async remove(id) {
    const r = getDb().prepare('DELETE FROM global_memories WHERE id = ?').run(id);
    if (r.changes > 0) invalidateMemoryCache();
    return r.changes > 0;
  },

  async search(query, topK) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const qTokens = tokenize(q);
    if (!qTokens.length) return [];
    const limit = Math.max(1, Math.min(topK, 20));

    // TTL 缓存命中 → 直接返回（不重复 FTS 预筛与打分）
    const cached = getCachedSearch(q);
    if (cached) return cached.slice(0, limit).map((e) => ({ ...e }));

    // FTS5 预筛候选（LIMIT 截断）→ 按 id 取行 → 复用既有 tokenize+score 精排
    const candidateIds = searchCandidateIds(q, SEARCH_LIMIT);
    const rows = candidateIds.length
      ? (getDb()
          .prepare(`SELECT * FROM global_memories WHERE id IN (${candidateIds.map(() => '?').join(',')})`)
          .all(...candidateIds) as any[])
      : [];

    const scored = rows
      .map((r) => {
        const entry = rowToEntry(r);
        const tags = entry.tags ?? [];
        const contentScore = score(qTokens, tokenize(entry.content));
        const tagScore = score(qTokens, tokenize(tags.join(' '))) * 1.5; // 标签加权
        return { entry, s: contentScore + tagScore };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    const results = scored.map(({ entry, s }) => ({ ...entry, score: Number(s.toFixed(4)) }));
    putCachedSearch(q, results);
    return results.slice(0, limit);
  },
};
