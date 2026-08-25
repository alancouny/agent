// ============================================================
// 全局记忆 FTS5 预筛检索 + TTL 缓存（R2）。
//
// 索引由 db/schema.ts 中的触发器自动维护（写路径无需业务双写）；
// 业务代码统一经本模块访问：searchCandidateIds / invalidateMemoryCache /
// rebuildFtsIndex / getCachedSearch / putCachedSearch。
// 禁止在其它文件手写 MATCH SQL（转义规则集中在本文件）。
// ============================================================

import { getDb, backfillFtsIndex } from '../db/database.js';
import type { MemoryEntry } from './types.js';

/** FTS 预筛候选上限（LIMIT 截断后走应用层精排）。 */
export const SEARCH_LIMIT = 100;

/** TTL 缓存时长（PRD Q-R2-2 默认 60s，暂不暴露配置）。 */
export const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  ts: number;
  results: MemoryEntry[];
}

const cache = new Map<string, CacheEntry>();

/** 全量重建 FTS 索引（幂等；供启动自愈 / 运维调用）。 */
export function rebuildFtsIndex(): void {
  backfillFtsIndex(getDb());
}

/** 记忆增删改后调用：清空全部检索缓存，避免脏读。 */
export function invalidateMemoryCache(): void {
  cache.clear();
}

/** TTL 缓存读取：命中且未过期返回结果，否则 undefined（过期条目顺手删除）。 */
export function getCachedSearch(query: string): MemoryEntry[] | undefined {
  const hit = cache.get(query);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(query);
    return undefined;
  }
  return hit.results;
}

/** TTL 缓存写入：键为 query，值为精排后的结果列表（topK 无关，调用方自行 slice）。 */
export function putCachedSearch(query: string, results: MemoryEntry[]): void {
  cache.set(query, { ts: Date.now(), results });
}

/**
 * FTS 预筛候选集（三路并集 + 去重，LIMIT 截断）：
 *   1) 英文词 / 标签   → global_memories_fts        (unicode61, MATCH "word")
 *   2) 中文 CJK 串 ≥3  → global_memories_fts_trigram (trigram, MATCH 原串)
 *   3) 中文 CJK 串 <3  → LIKE 子串兜底（已知最小化例外，S1）
 * 返回候选 id 列表（最多 limit 条）。
 */
export function searchCandidateIds(query: string, limit: number = SEARCH_LIMIT): string[] {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const ids = new Set<string>();
  const db = getDb();

  // 1) 英文词 / 标签（unicode61）：按词 MATCH，双引号包裹 + 转义防注入
  const words = (q.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => /^[a-z0-9_]+$/.test(w));
  if (words.length) {
    const match = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ');
    const rows = db
      .prepare(
        `SELECT gm.id FROM global_memories gm
         JOIN global_memories_fts f ON f.rowid = gm.rowid
         WHERE global_memories_fts MATCH ?
         LIMIT ?`
      )
      .all(match, limit) as { id: string }[];
    for (const r of rows) ids.add(r.id);
  }

  // 2) 中文（CJK）：按段分别预筛——≥3 字符段走 trigram，1-2 字符段走 LIKE 兜底，结果取并集。
  //    不能把所有段 join 成单一连续串："开源 项目" join 成 "开源项目" 走 trigram，
  //    内容含 "开源"+"项目" 但无连续子串 "开源项目" 时会漏召回（AC-R2-2 回归）。
  const cjkSegments = q.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjkSegments) {
    if (seg.length >= 3) {
      // trigram 需要查询串 ≥3 字符
      const rows = db
        .prepare(
          `SELECT gm.id FROM global_memories gm
           JOIN global_memories_fts_trigram f ON f.rowid = gm.rowid
           WHERE global_memories_fts_trigram MATCH ?
           LIMIT ?`
        )
        .all(seg, limit) as { id: string }[];
      for (const r of rows) ids.add(r.id);
    } else {
      // 1-2 字中文段：LIKE 子串兜底（trigram 无法处理 <3 字符，LIMIT 截断）
      const like = `%${seg}%`;
      const rows = db
        .prepare(`SELECT id FROM global_memories WHERE content LIKE ? OR tags LIKE ? LIMIT ?`)
        .all(like, like, limit) as { id: string }[];
      for (const r of rows) ids.add(r.id);
    }
  }

  return [...ids].slice(0, limit);
}
