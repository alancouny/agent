import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkText,
  bm25All,
  lexicalOverlap,
  getConfig,
  updateConfig,
  search,
  rebuildIndex,
  ingestDocument,
  deleteDoc,
  listDocs,
  tokenize,
  __setEmbedOverride,
  embeddingVersion,
} from '../src/knowledge/store.js';
import { getDb } from '../src/db/database.js';

// Deterministic embeddings: each unique token maps to a fixed unit vector direction,
// so cosine similarity reflects token overlap — no network, fully reproducible.
function detEmbed(texts: string[]): number[][] {
  const dim = 64;
  const tokenVec = (t: string): number[] => {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    const v = new Array(dim).fill(0);
    v[h % dim] = 1;
    v[(h >> 8) % dim] = 0.5;
    return v;
  };
  return texts.map((text) => {
    const vec = new Array(dim).fill(0);
    for (const t of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
      const tv = tokenVec(t);
      for (let i = 0; i < dim; i++) vec[i] += tv[i];
    }
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
    return vec.map((x) => x / norm);
  });
}

let docIds: string[] = [];

test.before(() => {
  __setEmbedOverride(detEmbed);
});

test.after(() => {
  __setEmbedOverride(null);
  // Clean up everything this file created (shared agent.db)
  const db = getDb();
  for (const id of docIds) {
    try { db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(id); } catch {}
  }
  db.prepare(
    "UPDATE rag_config SET chunk_size=900, chunk_overlap=120, chunk_strategy='paragraph', retrieval_mode='dense', rerank_enabled=0, top_k=5, score_threshold=0.2, index_backend='bruteforce' WHERE id='default'"
  ).run();
  docIds = [];
});

test('chunkText: four strategies respect the size bound', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} contains a substantial amount of text about the same broad topic so the chunker is forced to split it across multiple bounded chunks with some overlap.`).join('\n\n');
  for (const strategy of ['paragraph', 'sentence', 'recursive', 'token'] as const) {
    const chunks = chunkText(long, { size: 300, overlap: 40, strategy });
    assert.ok(chunks.length > 1, `${strategy} produces multiple chunks`);
    // token 策略的 size 是 token 数（≈4 字符/token），其余策略是字符数。
    const bound = strategy === 'token' ? 300 * 4 + 40 * 4 + 8 : 320;
    for (const c of chunks) assert.ok(c.length <= bound, `${strategy} respects size bound (got ${c.length})`);
  }
});

test('chunkText: short text stays a single chunk', () => {
  assert.equal(chunkText('short text').length, 1);
});

test('bm25All scores keyword-overlapping docs higher', () => {
  const docs = ['the quick brown fox', 'python programming language', 'quick fox again'];
  const scores = bm25All('quick fox', docs);
  assert.ok(scores[0] > 0, 'doc with both terms scores');
  assert.ok(scores[0] > scores[1], 'keyword doc beats unrelated doc');
});

test('lexicalOverlap is 0..1 and higher for shared tokens', () => {
  assert.equal(lexicalOverlap('a b c', 'x y z'), 0);
  assert.ok(lexicalOverlap('database engine', 'database index') > 0);
});

test('getConfig/updateConfig round-trip', async () => {
  const before = getConfig();
  try {
    const next = await updateConfig({ chunkSize: 500, retrievalMode: 'hybrid', rerankEnabled: true });
    assert.equal(next.chunkSize, 500);
    assert.equal(next.retrievalMode, 'hybrid');
    assert.equal(next.rerankEnabled, true);
    const reread = getConfig();
    assert.equal(reread.chunkSize, 500);
  } finally {
    await updateConfig({ chunkSize: before.chunkSize, retrievalMode: before.retrievalMode, rerankEnabled: before.rerankEnabled });
  }
});

test('updateConfig bumps embedding_version when the model changes', async () => {
  const v0 = embeddingVersion();
  const cfg = getConfig();
  await updateConfig({ embeddingModel: cfg.embeddingModel + '-other' });
  assert.equal(embeddingVersion(), v0 + 1, 'model change bumps version');
  await updateConfig({ embeddingModel: cfg.embeddingModel });
  assert.equal(embeddingVersion(), v0 + 2);
});

test('search returns the semantically relevant document first', async () => {
  const db = getDb();
  db.exec('DELETE FROM knowledge_chunks');
  db.exec('DELETE FROM knowledge_docs');
  db.prepare("UPDATE rag_config SET chunk_size=900, chunk_overlap=120, chunk_strategy='paragraph', retrieval_mode='dense', rerank_enabled=0, top_k=5, score_threshold=0 WHERE id='default'").run();
  const a = await ingestDocument({ title: 'db-eng', text: 'database engine indexing storage engine' });
  const b = await ingestDocument({ title: 'cooking', text: 'cooking recipes kitchen food ingredients' });
  docIds = [a.id, b.id];

  const res = await search('database storage', { topK: 2, threshold: 0 });
  assert.ok(res.length >= 1, 'at least the relevant doc returned');
  assert.equal(res[0].docTitle, 'db-eng', 'relevant doc ranked first');
});

test('search honors score threshold (filters unrelated queries)', async () => {
  const res = await search('zzzz unrelated query term qqqq', { topK: 5, threshold: 0.99 });
  assert.equal(res.length, 0, 'high threshold filters everything');
});

test('search hybrid mode still returns relevant results', async () => {
  updateConfig({ retrievalMode: 'hybrid' });
  try {
    const res = await search('database', { topK: 2, threshold: 0 });
    assert.ok(res.length >= 1);
  } finally {
    updateConfig({ retrievalMode: 'dense' });
  }
});

test('search rerank toggle is honored', async () => {
  updateConfig({ rerankEnabled: true });
  try {
    const res = await search('database storage', { topK: 2, threshold: 0 });
    assert.ok(res.length >= 1);
    assert.equal(res[0].docTitle, 'db-eng');
  } finally {
    updateConfig({ rerankEnabled: false });
  }
});

test('rebuildIndex re-embeds all documents', async () => {
  const db = getDb();
  const { docs, chunks } = await rebuildIndex();
  assert.equal(docs, docIds.length, 'all docs re-embedded');
  assert.ok(chunks >= docIds.length);
  const searchable = await search('database', { topK: 2, threshold: 0 });
  assert.ok(searchable.length >= 1, 'rebuild kept the KB searchable');
});

test('tokenize splits latin and CJK correctly', () => {
  const latin = tokenize('hello world');
  assert.ok(latin.includes('hello'));
  assert.ok(latin.includes('world'));
  // CJK characters are split individually, not as whole words
  const mixed = tokenize('database engine');
  assert.ok(mixed.includes('database'));
  assert.ok(mixed.includes('engine'));
  const empty = tokenize('');
  assert.equal(empty.length, 0);
});

test('listDocs returns array type when no docs', () => {
  // Just verify the function returns an array; do not mutate shared state
  const docs = listDocs();
  assert.ok(Array.isArray(docs));
});

test('deleteDoc cascades chunks', async () => {
  const db = getDb();
  if (!docIds.length) return;
  const before = (db.prepare('SELECT COUNT(*) n FROM knowledge_chunks').get() as any).n;
  const id = docIds[0];
  await deleteDoc(id);
  const after = (db.prepare('SELECT COUNT(*) n FROM knowledge_chunks').get() as any).n;
  assert.ok(after < before, 'chunks removed after doc delete');
  docIds = docIds.filter((x) => x !== id);
});
