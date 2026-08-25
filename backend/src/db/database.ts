import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './schema.js';

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'agent.db');

/**
 * Resolve the SQLite database path.
 *
 * `AGENT_DB_PATH` overrides the default for tests and special deployments:
 * - `:memory:` → a private in-memory DB (each node:test file runs in its own
 *   process, so tests get full isolation and never touch the real dev DB);
 * - any filesystem path → used verbatim (relative paths resolve against cwd).
 *
 * Production default is unchanged: `<cwd>/data/agent.db`.
 */
function resolveDbPath(): string {
  const override = process.env.AGENT_DB_PATH?.trim();
  if (override) return override;
  return DEFAULT_DB_PATH;
}

let db: Database.Database | null = null;

/**
 * 版本化 migration（PRAGMA user_version）统一入口。
 * 所有表结构变更必须追加到这里，禁止在其它文件散落 ALTER TABLE。
 */
interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      // Migration for pre-existing databases: add raw_text column used by rebuildIndex.
      try {
        db.exec(`ALTER TABLE knowledge_docs ADD COLUMN raw_text TEXT`);
      } catch {
        // column already exists — ignore
      }
      // Migration: embedding versioning for two-phase hybrid search.
      try {
        db.exec(`ALTER TABLE knowledge_chunks ADD COLUMN embedding_version INTEGER DEFAULT 1`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_ver ON knowledge_chunks(embedding_version)`);
      } catch {
        // column already exists — ignore
      }
      // Migration: rag_config.embedding_version (bumped on model change; search skips stale vectors).
      try {
        db.exec(`ALTER TABLE rag_config ADD COLUMN embedding_version INTEGER DEFAULT 1`);
      } catch {
        // column already exists — ignore
      }
      // Migration: tool-result tool name on messages (used by loadMessages on resume).
      try {
        const msgCols = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
        if (!msgCols.some((c) => c.name === 'name')) {
          db.exec(`ALTER TABLE messages ADD COLUMN name TEXT`);
        }
      } catch {
        // ignore
      }
      // Ensure the column exists on fresh DBs too (SCHEMA_SQL includes it, this is a no-op guard).
      try {
        const cols = db.prepare(`PRAGMA table_info(rag_config)`).all() as { name: string }[];
        if (!cols.some((c) => c.name === 'embedding_version')) {
          db.exec(`ALTER TABLE rag_config ADD COLUMN embedding_version INTEGER DEFAULT 1`);
        }
        const chunkCols = db.prepare(`PRAGMA table_info(knowledge_chunks)`).all() as { name: string }[];
        if (!chunkCols.some((c) => c.name === 'embedding_version')) {
          db.exec(`ALTER TABLE knowledge_chunks ADD COLUMN embedding_version INTEGER DEFAULT 1`);
        }
      } catch {
        // tables may not exist yet on first boot — schema.exec above handles them
      }
    },
  },
  {
    version: 2,
    up(db) {
      // R2：global_memories FTS5 索引。SCHEMA_SQL 已建虚拟表 + 同步触发器（IF NOT EXISTS），
      // 这里对 R2 之前的存量库做幂等建表 + 全量回填（external content 不可用 'rebuild' 命令）。
      db.exec(FTS_SCHEMA_SQL);
      backfillFtsIndex(db);
    },
  },
];

/**
 * 全量重建 global_memories 的 FTS5 索引（幂等）。
 * external content 表不可用 `INSERT INTO fts(fts) VALUES('rebuild')`，
 * 必须逐行执行 'delete' + 'insert' 回填。
 */
export function backfillFtsIndex(db: Database.Database): void {
  const rows = db
    .prepare('SELECT rowid, content, tags FROM global_memories')
    .all() as { rowid: number; content: string; tags: string }[];
  if (!rows.length) return;
  const deleteFts = db.prepare(
    `INSERT INTO global_memories_fts(global_memories_fts, rowid, content, tags) VALUES('delete', @rowid, @content, @tags)`
  );
  const insertFts = db.prepare(
    `INSERT INTO global_memories_fts(rowid, content, tags) VALUES(@rowid, @content, @tags)`
  );
  const deleteTri = db.prepare(
    `INSERT INTO global_memories_fts_trigram(global_memories_fts_trigram, rowid, content) VALUES('delete', @rowid, @content)`
  );
  const insertTri = db.prepare(
    `INSERT INTO global_memories_fts_trigram(rowid, content) VALUES(@rowid, @content)`
  );
  db.transaction(() => {
    for (const r of rows) {
      deleteFts.run(r);
      insertFts.run(r);
      deleteTri.run(r);
      insertTri.run(r);
    }
  })();
}

/** 启动自愈：FTS 行数 < 主表行数时全量回填（幂等，每次进程启动校验一次）。 */
export function ensureFtsIndex(db: Database.Database): void {
  const mainCount = (db.prepare('SELECT COUNT(*) AS c FROM global_memories').get() as { c: number }).c;
  const ftsCount = (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts').get() as { c: number }).c;
  if (ftsCount < mainCount) backfillFtsIndex(db);
}

/** 按序执行未应用的 migration，并把 user_version 推进到最新版本。 */
export function migrate(db: Database.Database): void {
  let current = Number(db.pragma('user_version', { simple: true })) || 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    m.up(db);
    db.pragma(`user_version = ${m.version}`);
    current = m.version;
  }
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = resolveDbPath();
    const isMemory = dbPath === ':memory:';
    if (!isMemory) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    db = new Database(dbPath);
    if (!isMemory) {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('foreign_keys = ON');
    // WAL + busy_timeout: concurrent readers are fine; writes queue up to 30s
    // instead of failing with "database is locked".
    db.pragma('busy_timeout = 30000');
    db.exec(SCHEMA_SQL);
    // 统一 migration 入口：所有存量库结构变更在此按版本执行
    migrate(db);
    // R2 启动自愈：FTS 索引行数落后于主表时全量回填（幂等）
    ensureFtsIndex(db);
  }
  return db;
}

/** Retry wrapper for write operations that may fail with "database is locked" under concurrent load. */
export async function withDbRetry<T>(fn: () => T, maxRetries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn();
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      if (!/database is locked|SQLITE_BUSY/i.test(msg)) throw e;
      lastErr = e;
      // brief exponential backoff before retry
      if (i < maxRetries - 1) {
        const ms = 50 * (1 << i); // 50 / 100 / 200 ms
        await new Promise((r) => setTimeout(r, ms));
      }
    }
  }
  throw lastErr;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}