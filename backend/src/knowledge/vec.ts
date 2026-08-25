// ============================================================
// sqlite-vec native KNN acceleration.
//
// Loads the sqlite-vec extension (npm `sqlite-vec` package first,
// then SQLITE_VEC_PATH env var, then bare names) and manages a
// `vec0` virtual table (cosine metric) whose rowids mirror
// knowledge_chunks rowids. Everything degrades gracefully:
// if the extension cannot be loaded, `available` is false and
// the caller falls back to brute-force cosine in store.ts.
//
// Rowid gotcha: vec0 requires 64-bit rowids — bind as BigInt.
// ============================================================

import { getDb } from '../db/database.js';
import type { Database } from 'better-sqlite3';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const VEC_TABLE = 'knowledge_vec';

interface VecState {
  loaded: boolean;
  reason: string;
  version: string;
  /** Dimension of the current vec table (0 = not created yet). */
  dim: number;
}

let state: VecState = { loaded: false, reason: '', version: '', dim: 0 };

function f32buf(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

/** Try to load the extension once. Returns true when vec_version() responds. */
export function ensureLoaded(): boolean {
  if (state.loaded) return true;
  const db = getDb() as Database;

  // 1) npm package's own loader (platform-correct .dylib/.so/.dll path)
  try {
    const mod = require('sqlite-vec') as { load: (db: Database) => void; getLoadablePath: () => string };
    mod.load(db);
    const row = db.prepare('select vec_version() as v').get() as { v: string };
    state = { loaded: true, reason: '', version: row.v, dim: state.dim };
    return true;
  } catch (e: unknown) {
    state.reason = `npm loader failed: ${(e as Error).message}`;
  }

  // 2) explicit path via env
  const envPath = process.env.SQLITE_VEC_PATH;
  if (envPath) {
    try {
      db.loadExtension(envPath);
      const row = db.prepare('select vec_version() as v').get() as { v: string };
      state = { loaded: true, reason: '', version: row.v, dim: state.dim };
      return true;
    } catch (e: unknown) {
      state.reason += `; SQLITE_VEC_PATH failed: ${(e as Error).message}`;
    }
  }

  // 3) bare names (system install)
  for (const name of ['vec0', 'sqlite_vec0', 'sqlite-vec']) {
    try {
      db.loadExtension(name);
      const row = db.prepare('select vec_version() as v').get() as { v: string };
      state = { loaded: true, reason: '', version: row.v, dim: state.dim };
      return true;
    } catch {
      /* try next */
    }
  }
  state.reason += '; no loadable extension found';
  return false;
}

export function vecStatus(): {
  available: boolean;
  version: string;
  reason: string;
  dim: number;
  indexed: number;
  tableExists: boolean;
} {
  const db = getDb();
  const tableExists = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(VEC_TABLE);
  let indexed = 0;
  if (state.loaded && tableExists) {
    try {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM ${VEC_TABLE}`).get() as { n: number };
      indexed = r.n;
    } catch {
      indexed = 0;
    }
  }
  return {
    available: state.loaded,
    version: state.version,
    reason: state.reason,
    dim: state.dim,
    indexed,
    tableExists,
  };
}

/** Drop + recreate the vec table at `dim` (cosine metric). */
export function recreateTable(dim: number): boolean {
  if (!state.loaded) return false;
  const db = getDb();
  try {
    db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
    db.exec(
      `CREATE VIRTUAL TABLE ${VEC_TABLE} USING vec0(embedding float[${dim}] distance_metric=cosine)`
    );
    state.dim = dim;
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuild the vec table from knowledge_chunks embeddings (no embedding API calls).
 * Detects dimension from the first stored vector; recreates the table on mismatch.
 */
export function syncVecIndex(): { ok: boolean; indexed: number; dim: number } {
  const db = getDb();
  if (!state.loaded) return { ok: false, indexed: 0, dim: 0 };

  const rows = db
    .prepare(
      `SELECT rowid, embedding FROM knowledge_chunks WHERE embedding IS NOT NULL AND embedding != '[]' AND embedding_version = (SELECT embedding_version FROM rag_config WHERE id='default') ORDER BY rowid`
    )
    .all() as { rowid: number | bigint; embedding: string }[];

  let dim = 0;
  if (rows.length) {
    try {
      const parsed = JSON.parse(rows[0].embedding) as number[];
      dim = parsed.length;
    } catch {
      return { ok: false, indexed: 0, dim: 0 };
    }
  }
  if (dim <= 0) {
    // nothing to index — ensure a sensible default table still exists
    if (!state.dim) recreateTable(768);
    return { ok: true, indexed: 0, dim: state.dim };
  }
  if (state.dim !== dim) {
    if (!recreateTable(dim)) return { ok: false, indexed: 0, dim };
  }

  const ins = db.prepare(`INSERT OR REPLACE INTO ${VEC_TABLE}(rowid, embedding) VALUES (?, ?)`);
  const clear = () => {
    try {
      db.prepare(`DELETE FROM ${VEC_TABLE}`).run();
    } catch {
      recreateTable(dim);
    }
  };
  const tx = db.transaction((items: { rowid: number | bigint; vec: number[] }[]) => {
    clear();
    for (const it of items) ins.run(BigInt(it.rowid), f32buf(it.vec));
  });
  try {
    tx(
      rows.map((r) => ({
        rowid: r.rowid,
        vec: JSON.parse(r.embedding) as number[],
      }))
    );
    return { ok: true, indexed: rows.length, dim };
  } catch {
    return { ok: false, indexed: 0, dim };
  }
}

export interface VecHit {
  rowid: number | bigint;
  similarity: number; // cosine similarity (1 - distance)
}

/** SQL KNN: top-k nearest chunks. Returns cosine similarity in [0..1]. */
export function knn(queryVec: number[], k: number): VecHit[] {
  if (!state.loaded || !state.dim) return [];
  const db = getDb();
  const tableExists = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(VEC_TABLE);
  if (!tableExists) return [];
  if (queryVec.length !== state.dim) return [];
  try {
    const rows = db
      .prepare(
        `SELECT rowid, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? AND k = ? ORDER BY distance`
      )
      .all(f32buf(queryVec), Math.max(1, Math.floor(k))) as { rowid: number | bigint; distance: number }[];
    return rows.map((r) => ({ rowid: r.rowid, similarity: Math.max(0, 1 - r.distance) }));
  } catch {
    return [];
  }
}
