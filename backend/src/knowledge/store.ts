/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// Knowledge Base (RAG) — fully configurable, dependency-light vector store.
//
// Every layer of the RAG pipeline is user-configurable per knowledge base:
//   - embedding model / provider / api key   (OpenAI-compatible /embeddings)
//   - chunk size, overlap and strategy        (paragraph | sentence | recursive | token)
//   - retrieval mode                          (dense | hybrid BM25+vector)
//   - optional two-pass rerank
//   - retrieval tuning                        (topK, score threshold)
//   - index backend                           (bruteforce | sqlitevec with auto-fallback)
//
// Vectors are stored as JSON in SQLite and searched with cosine (brute-force) in JS
// by default. The optional `sqlitevec` backend is selected only when the sqlite-vec
// native extension is loadable; otherwise it falls back to brute-force automatically
// so search always works.
// ============================================================

import { getDb, withDbRetry } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import { ensureLoaded, knn, syncVecIndex, vecStatus } from './vec.js';

export type ChunkStrategy = 'paragraph' | 'sentence' | 'recursive' | 'token';
export type RetrievalMode = 'dense' | 'hybrid';
export type IndexBackend = 'bruteforce' | 'sqlitevec';

export interface RagConfig {
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  chunkSize: number;
  chunkOverlap: number;
  chunkStrategy: ChunkStrategy;
  retrievalMode: RetrievalMode;
  rerankEnabled: boolean;
  topK: number;
  scoreThreshold: number;
  indexBackend: IndexBackend;
  /** Bumped when the embedding model/provider changes; chunks stamped with a stale version are ignored. */
  embeddingVersion?: number;
}

const ENV = {
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  embeddingBaseUrl:
    process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '',
};

const DEFAULTS: RagConfig = {
  embeddingModel: ENV.embeddingModel,
  embeddingBaseUrl: ENV.embeddingBaseUrl,
  embeddingApiKey: ENV.embeddingApiKey,
  chunkSize: 900,
  chunkOverlap: 120,
  chunkStrategy: 'paragraph',
  retrievalMode: 'dense',
  rerankEnabled: false,
  topK: 5,
  scoreThreshold: 0.2,
  indexBackend: 'bruteforce',
};

// ── Test seam: allow deterministic embeddings in unit tests ──
let embedOverride: ((texts: string[]) => Promise<number[][]>) | null = null;
export function __setEmbedOverride(fn: ((texts: string[]) => Promise<number[][]>) | null): void {
  embedOverride = fn;
}

export function getConfig(): RagConfig {
  const db = getDb();
  let row = db.prepare(`SELECT * FROM rag_config WHERE id='default'`).get() as any;
  if (!row) {
    db.prepare(
      `INSERT INTO rag_config
        (id, embedding_model, embedding_base_url, embedding_api_key, chunk_size, chunk_overlap,
         chunk_strategy, retrieval_mode, rerank_enabled, top_k, score_threshold, index_backend, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      DEFAULTS.embeddingModel,
      DEFAULTS.embeddingBaseUrl,
      DEFAULTS.embeddingApiKey,
      DEFAULTS.chunkSize,
      DEFAULTS.chunkOverlap,
      DEFAULTS.chunkStrategy,
      DEFAULTS.retrievalMode,
      DEFAULTS.rerankEnabled ? 1 : 0,
      DEFAULTS.topK,
      DEFAULTS.scoreThreshold,
      DEFAULTS.indexBackend
    );
    row = db.prepare(`SELECT * FROM rag_config WHERE id='default'`).get() as any;
  }
  return {
    embeddingModel: row.embedding_model || DEFAULTS.embeddingModel,
    embeddingBaseUrl: row.embedding_base_url || DEFAULTS.embeddingBaseUrl,
    embeddingApiKey: row.embedding_api_key || DEFAULTS.embeddingApiKey,
    chunkSize: Number.isFinite(row.chunk_size) ? row.chunk_size : DEFAULTS.chunkSize,
    chunkOverlap: Number.isFinite(row.chunk_overlap) ? row.chunk_overlap : DEFAULTS.chunkOverlap,
    chunkStrategy: (row.chunk_strategy as ChunkStrategy) || DEFAULTS.chunkStrategy,
    retrievalMode: (row.retrieval_mode as RetrievalMode) || DEFAULTS.retrievalMode,
    rerankEnabled: !!row.rerank_enabled,
    topK: Number.isFinite(row.top_k) ? row.top_k : DEFAULTS.topK,
    scoreThreshold: Number.isFinite(row.score_threshold) ? row.score_threshold : DEFAULTS.scoreThreshold,
    indexBackend: (row.index_backend as IndexBackend) || DEFAULTS.indexBackend,
    embeddingVersion: Number(row.embedding_version) || 1,
  };
}

export async function updateConfig(patch: Partial<RagConfig>): Promise<RagConfig> {
  const old = getConfig();
  const next = { ...old, ...patch };
  // Changing the embedding model / provider invalidates every stored vector:
  // bump the version so search ignores stale chunks until a rebuild.
  // Compare against the OLD config (patch vs merged-next is always false).
  const embeddingChanged =
    (patch.embeddingModel !== undefined && patch.embeddingModel !== old.embeddingModel) ||
    (patch.embeddingBaseUrl !== undefined && patch.embeddingBaseUrl !== old.embeddingBaseUrl);
  const db = getDb();
  const row = db.prepare(`SELECT embedding_version FROM rag_config WHERE id='default'`).get() as { embedding_version?: number } | undefined;
  const version = (row?.embedding_version || 1) + (embeddingChanged ? 1 : 0);
  await withDbRetry(() =>
    db.prepare(
      `UPDATE rag_config SET
       embedding_model=?, embedding_base_url=?, embedding_api_key=?,
       chunk_size=?, chunk_overlap=?, chunk_strategy=?,
       retrieval_mode=?, rerank_enabled=?, top_k=?, score_threshold=?, index_backend=?,
       embedding_version=?, updated_at=datetime('now')
     WHERE id='default'`
    ).run(
      next.embeddingModel,
      next.embeddingBaseUrl,
      next.embeddingApiKey,
      next.chunkSize,
      next.chunkOverlap,
      next.chunkStrategy,
      next.retrievalMode,
      next.rerankEnabled ? 1 : 0,
      next.topK,
      next.scoreThreshold,
      next.indexBackend,
      version
    )
  );
  return { ...getConfig(), embeddingVersion: version };
}

/** Current embedding version stored in the config row (1 = initial). */
export function embeddingVersion(): number {
  const db = getDb();
  const row = db.prepare(`SELECT embedding_version FROM rag_config WHERE id='default'`).get() as { embedding_version?: number } | undefined;
  return Number(row?.embedding_version) || 1;
}

/** bruteforce 检索的解析后向量缓存（embedding 版本/文档数变化时失效）。 */
let bruteCache: {
  version: number;
  count: number;
  rows: { rowid: number | bigint; content: string; title: string; vec: number[] }[];
} | null = null;

export async function embed(texts: string[], cfg?: RagConfig): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (embedOverride) return embedOverride(texts);
  const c = cfg || getConfig();
  const { OpenAI } = await import('openai');
  // timeout + 有限重试：embedding 服务不可用时应快速失败降级，而不是挂起整个检索/请求
  const client = new OpenAI({ baseURL: c.embeddingBaseUrl, apiKey: c.embeddingApiKey, timeout: 8000, maxRetries: 1 });
  const resp = await client.embeddings.create({ model: c.embeddingModel, input: texts });
  return resp.data.map((d) => d.embedding as number[]);
}

// ── Tokenization (shared by BM25 + rerank) ──
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const ascii = s.toLowerCase().match(/[a-z0-9]+/gi) || [];
  out.push(...ascii);
  const cjk = s.match(/[一-鿿]/g) || [];
  out.push(...cjk);
  return out;
}

// ── Chunking strategies ──
const RECURSIVE_SEPS = ['\n#{1,6} ', '\n\n', '\n', '. ', '! ', '? ', ' ', ''];

export function chunkText(
  text: string,
  opts?: Partial<{ size: number; overlap: number; strategy: ChunkStrategy }>
): string[] {
  const cfg = getConfig();
  const size = opts?.size ?? cfg.chunkSize;
  const overlap = opts?.overlap ?? cfg.chunkOverlap;
  const strategy = opts?.strategy ?? cfg.chunkStrategy;
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  switch (strategy) {
    case 'sentence':
      return splitBySentence(clean, size);
    case 'recursive':
      return splitRecursive(clean, size, overlap);
    case 'token':
      return splitByToken(clean, size, overlap);
    case 'paragraph':
    default:
      return splitByParagraph(clean, size);
  }
}

function splitByParagraph(text: string, size: number): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf.length + p.length + 1 <= size) {
      buf = buf ? `${buf}\n\n${p}` : p;
      continue;
    }
    if (buf) chunks.push(buf);
    if (p.length > size) {
      const sentences = p.match(/[^。！？.!?]+[。！？.!?]?/g) || [p];
      let sb = '';
      for (const s of sentences) {
        if (sb.length + s.length > size) {
          chunks.push(sb);
          sb = s;
        } else sb += s;
      }
      buf = sb;
    } else {
      buf = p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [text.slice(0, size)];
}

function splitBySentence(text: string, size: number): string[] {
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]?/g) || [text];
  const chunks: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf.length + s.length <= size) {
      buf += s;
      continue;
    }
    if (buf) chunks.push(buf);
    if (s.length > size) {
      for (let i = 0; i < s.length; i += Math.max(1, size)) chunks.push(s.slice(i, i + size));
      buf = '';
    } else {
      buf = s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [text.slice(0, size)];
}

function splitRecursive(text: string, size: number, overlap: number, sepIdx = 0): string[] {
  if (text.length <= size) return text ? [text] : [];
  const sep = RECURSIVE_SEPS[sepIdx] ?? '';
  if (sepIdx >= RECURSIVE_SEPS.length - 1) {
    const out: string[] = [];
    const step = Math.max(1, size - overlap);
    for (let i = 0; i < text.length; i += step) out.push(text.slice(i, i + size));
    return out.filter(Boolean).length ? out.filter(Boolean) : [text.slice(0, size)];
  }
  const parts = text.split(new RegExp(sep));
  const merged: string[] = [];
  let buf = '';
  for (const p of parts) {
    if (!p) continue;
    const piece = sep.trim() ? p + sep : p;
    if (buf.length + piece.length <= size) {
      buf += piece;
    } else {
      if (buf) merged.push(buf);
      if (piece.length > size) merged.push(...splitRecursive(piece, size, overlap, sepIdx + 1));
      else buf = piece;
    }
  }
  if (buf) merged.push(buf);
  return merged.length ? merged : [text.slice(0, size)];
}

function splitByToken(text: string, sizeTok: number, overlapTok: number): string[] {
  const size = Math.max(1, sizeTok) * 4; // ~4 chars per token
  const overlap = Math.max(0, overlapTok) * 4;
  const out: string[] = [];
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < text.length; i += step) out.push(text.slice(i, i + size));
  const filtered = out.filter(Boolean);
  return filtered.length ? filtered : [text.slice(0, size)];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** BM25 scores of `docs` against a `query` (Okapi BM25). */
export function bm25All(query: string, docs: string[]): number[] {
  const qTerms = tokenize(query);
  if (!qTerms.length) return docs.map(() => 0);
  const docTokens = docs.map((d) => tokenize(d));
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const uniq = new Set(tokens);
    uniq.forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  }
  const N = docs.length;
  const avgdl = docTokens.reduce((s, t) => s + t.length, 0) / (N || 1);
  const k1 = 1.5,
    b = 0.75;
  return docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    let score = 0;
    for (const t of qTerms) {
      if (!df.has(t)) continue;
      const idf = Math.log((N - df.get(t)! + 0.5) / (df.get(t)! + 0.5) + 1);
      const f = tf.get(t) || 0;
      const dl = tokens.length;
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl)));
    }
    return score;
  });
}

/** Jaccard lexical overlap between query and document (0..1). */
export function lexicalOverlap(query: string, doc: string): number {
  const a = new Set(tokenize(query));
  const b = new Set(tokenize(doc));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((t) => {
    if (b.has(t)) inter++;
  });
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

// ── sqlite-vec optional acceleration (native KNN via vec.ts) ──
let sqliteVecAvailable: boolean | null = null;
function sqliteVecLoaded(): boolean {
  if (sqliteVecAvailable !== null) return sqliteVecAvailable;
  sqliteVecAvailable = ensureLoaded();
  return sqliteVecAvailable;
}

/** The backend actually in use: sqlitevec only if selected AND loadable, else bruteforce. */
export function effectiveBackend(cfg: RagConfig = getConfig()): IndexBackend {
  if (cfg.indexBackend === 'sqlitevec' && sqliteVecLoaded()) return 'sqlitevec';
  return 'bruteforce';
}

export function indexStatus(): {
  configured: IndexBackend;
  effective: IndexBackend;
  sqliteVecAvailable: boolean;
  vec: ReturnType<typeof vecStatus>;
} {
  const cfg = getConfig();
  return {
    configured: cfg.indexBackend,
    effective: effectiveBackend(cfg),
    sqliteVecAvailable: sqliteVecLoaded(),
    vec: vecStatus(),
  };
}

/** Rebuild the native vec table from stored embeddings (no embedding API calls). */
export function syncIndex(): { ok: boolean; indexed: number; dim: number } {
  return syncVecIndex();
}

export interface IngestResult {
  id: string;
  title: string;
  chunks: number;
}

/** Ingest raw text into the knowledge base (chunk + embed + store), using the active config. */
export async function ingestDocument(opts: {
  title: string;
  source?: string;
  text: string;
  config?: RagConfig;
}): Promise<IngestResult> {
  const cfg = opts.config || getConfig();
  const docId = uuidv4();
  const chunks = chunkText(opts.text, {
    size: cfg.chunkSize,
    overlap: cfg.chunkOverlap,
    strategy: cfg.chunkStrategy,
  });
  const vectors = await embed(chunks, cfg);
  const db = getDb();
  const version = embeddingVersion();
  const insDoc = db.prepare(
    `INSERT INTO knowledge_docs (id, title, source, chunk_count, raw_text) VALUES (?, ?, ?, ?, ?)`
  );
  const insChunk = db.prepare(
    `INSERT INTO knowledge_chunks (id, doc_id, idx, content, embedding, embedding_version) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    insDoc.run(docId, opts.title, opts.source || null, chunks.length, opts.text);
    chunks.forEach((c, i) => {
      insChunk.run(uuidv4(), docId, i, c, JSON.stringify(vectors[i] || []), version);
    });
  });
  tx();
  return { id: docId, title: opts.title, chunks: chunks.length };
}

export interface RetrievedChunk {
  content: string;
  score: number;
  docTitle: string;
}

/** Retrieve the top-K chunks most relevant to the query, honoring config (mode/rerank/tuning). */
export async function search(
  query: string,
  opts?: { topK?: number; threshold?: number; config?: RagConfig }
): Promise<RetrievedChunk[]> {
  const cfg = opts?.config || getConfig();
  const topK = opts?.topK ?? cfg.topK;
  const threshold = opts?.threshold ?? cfg.scoreThreshold;
  const db = getDb();

  let qVec: number[] | undefined;
  try {
    qVec = (await embed([query], cfg))[0];
  } catch {
    qVec = undefined; // embedding service unavailable — degrade gracefully to no results
  }
  if (!qVec || qVec.length === 0) return [];

  // ── Candidate generation ──
  // sqlite-vec path: SQL KNN returns the top (topK*2) chunks with native cosine similarity.
  // bruteforce path: scan all chunks in JS.
  let candidates: { rowid: number | bigint; content: string; docTitle: string; dense: number; bm25: number; score: number }[] = [];

  if (effectiveBackend(cfg) === 'sqlitevec') {
    const hits = knn(qVec, Math.max(topK * 2, 10));
    if (hits.length) {
      const rowIds = hits.map((h) => h.rowid);
      const placeholders = rowIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT c.rowid AS rowid, c.content AS content, d.title AS title
           FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
           WHERE c.rowid IN (${placeholders}) AND c.embedding_version = ?`
        )
        .all(...rowIds, embeddingVersion()) as { rowid: number | bigint; content: string; title: string }[];
      const byRow = new Map<string | number, typeof rows[number]>();
      for (const r of rows) byRow.set(String(r.rowid), r);
      candidates = hits
        .map((h) => {
          const r = byRow.get(String(h.rowid));
          if (!r) return null;
          return { rowid: r.rowid, content: r.content, docTitle: r.title, dense: h.similarity, bm25: 0, score: h.similarity };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }
  } else {
    // bruteforce 路径：缓存解析后的向量，避免每轮检索全量拉库 + 逐个 JSON.parse
    // （embedding 版本或文档数变化时自动失效）
    if (
      !bruteCache ||
      bruteCache.version !== embeddingVersion() ||
      bruteCache.count !== docCount()
    ) {
      const rows = db
        .prepare(
          `SELECT c.rowid AS rowid, c.content AS content, c.embedding AS embedding, d.title AS title
           FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
           WHERE c.embedding_version = ?`
        )
        .all(embeddingVersion()) as { rowid: number | bigint; content: string; embedding: string | null; title: string }[];
      bruteCache = {
        version: embeddingVersion(),
        count: docCount(),
        rows: rows.map((r) => {
          let vec: number[] = [];
          try {
            vec = r.embedding ? JSON.parse(r.embedding) : [];
          } catch {
            vec = [];
          }
          return { rowid: r.rowid, content: r.content, title: r.title, vec };
        }),
      };
    }
    const cached = bruteCache;
    const dense = cached.rows.map((r) => (r.vec.length ? cosine(qVec, r.vec) : 0));
    candidates = cached.rows.map((r, i) => ({
      rowid: r.rowid,
      content: r.content,
      docTitle: r.title,
      dense: dense[i],
      bm25: 0,
      score: dense[i],
    }));
  }

  if (candidates.length === 0) return [];

  // ── Hybrid fusion (normalized BM25 + dense) ──
  if (cfg.retrievalMode === 'hybrid') {
    const bm25s = bm25All(query, candidates.map((c) => c.content));
    const maxB = Math.max(...bm25s, 1e-9);
    candidates = candidates.map((s, i) => ({
      ...s,
      bm25: bm25s[i],
      score: 0.7 * s.dense + 0.3 * (bm25s[i] / maxB),
    }));
  }

  // ── Optional rerank on a bounded candidate set ──
  if (cfg.rerankEnabled) {
    const shortlist = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(topK * 2, 10));
    candidates = shortlist.map((s) => ({
      ...s,
      score: s.score * 0.6 + lexicalOverlap(query, s.content) * 0.4,
    }));
  }

  return candidates
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({ content: s.content, score: s.score, docTitle: s.docTitle }));
}

/** Re-embed the entire knowledge base with the current config (call after changing the model). */
export async function rebuildIndex(): Promise<{ docs: number; chunks: number }> {
  const cfg = getConfig();
  const db = getDb();
  const version = embeddingVersion();
  const docs = db
    .prepare(`SELECT id, raw_text, title FROM knowledge_docs WHERE raw_text IS NOT NULL`)
    .all() as { id: string; raw_text: string; title: string }[];
  const delChunks = db.prepare(`DELETE FROM knowledge_chunks WHERE doc_id = ?`);
  const insChunk = db.prepare(
    `INSERT INTO knowledge_chunks (id, doc_id, idx, content, embedding, embedding_version) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const updDoc = db.prepare(`UPDATE knowledge_docs SET chunk_count = ? WHERE id = ?`);
  let totalChunks = 0;
  for (const doc of docs) {
    const chunks = chunkText(doc.raw_text, {
      size: cfg.chunkSize,
      overlap: cfg.chunkOverlap,
      strategy: cfg.chunkStrategy,
    });
    const vectors = await embed(chunks, cfg);
    const tx = db.transaction(() => {
      delChunks.run(doc.id);
      chunks.forEach((c, i) => {
        insChunk.run(uuidv4(), doc.id, i, c, JSON.stringify(vectors[i] || []), version);
      });
      updDoc.run(chunks.length, doc.id);
    });
    await withDbRetry(tx);
    totalChunks += chunks.length;
  }
  return { docs: docs.length, chunks: totalChunks };
}

export function listDocs(): { id: string; title: string; source: string | null; chunk_count: number; created_at: string }[] {
  return getDb()
    .prepare(`SELECT id, title, source, chunk_count, created_at FROM knowledge_docs ORDER BY created_at DESC`)
    .all() as { id: string; title: string; source: string | null; chunk_count: number; created_at: string }[];
}

export async function deleteDoc(id: string): Promise<boolean> {
  const db = getDb();
  // Cascade: remove chunks first, then the doc itself
  await withDbRetry(() => db.prepare(`DELETE FROM knowledge_chunks WHERE doc_id = ?`).run(id));
  const res = await withDbRetry(() => db.prepare(`DELETE FROM knowledge_docs WHERE id = ?`).run(id));
  return res.changes > 0;
}

export function docCount(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM knowledge_chunks`).get() as { n: number };
  return row.n;
}
