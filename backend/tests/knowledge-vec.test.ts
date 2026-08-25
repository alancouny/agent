import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureLoaded, vecStatus, recreateTable, syncVecIndex } from '../src/knowledge/vec.js';
import { indexStatus, syncIndex, __setEmbedOverride, ingestDocument, updateConfig } from '../src/knowledge/store.js';
import { getDb } from '../src/db/database.js';

test('vecStatus returns structure even when extension unavailable', () => {
  const s = vecStatus();
  assert.ok('available' in s);
  assert.ok('version' in s);
  assert.ok('reason' in s);
  assert.ok('dim' in s);
  assert.ok('indexed' in s);
  assert.ok('tableExists' in s);
});

test('ensureLoaded returns boolean', () => {
  const ok = ensureLoaded();
  assert.equal(typeof ok, 'boolean');
});

test('recreateTable returns false when vec not loaded', () => {
  if (!ensureLoaded()) {
    assert.equal(recreateTable(64), false);
  } else {
    const ok = recreateTable(64);
    assert.equal(typeof ok, 'boolean');
  }
});

test('syncVecIndex returns result object', () => {
  const r = syncVecIndex();
  assert.ok('ok' in r);
  assert.ok('indexed' in r);
  assert.ok('dim' in r);
  assert.equal(typeof r.ok, 'boolean');
});

test('indexStatus returns consistent structure', () => {
  const s = indexStatus();
  assert.ok('configured' in s);
  assert.ok('effective' in s);
  assert.ok('sqliteVecAvailable' in s);
  assert.ok('vec' in s);
  assert.equal(typeof s.sqliteVecAvailable, 'boolean');
});

test('syncIndex matches vec syncVecIndex', async () => {
  const vecR = syncVecIndex();
  const storeR = syncIndex();
  assert.equal(vecR.ok, storeR.ok);
  assert.equal(vecR.indexed, storeR.indexed);
  assert.equal(vecR.dim, storeR.dim);
});

test('ingest with deterministic embed and sync works end-to-end', async () => {
  const detEmbed = async (texts: string[]) => texts.map(() => Array(8).fill(0.1));
  __setEmbedOverride(detEmbed);
  try {
    const db = getDb();
    // clean slate
    db.exec('DELETE FROM knowledge_chunks');
    db.exec('DELETE FROM knowledge_docs');
    await updateConfig({ chunkSize: 200, chunkOverlap: 20, indexBackend: 'bruteforce' });
    const res = await ingestDocument({ title: 'test-doc', text: 'vector test content for integration test' });
    assert.ok(res.id);
    assert.ok(res.chunks >= 1);
    const idx = indexStatus();
    assert.equal(typeof idx.effective, 'string');
    const sync = syncIndex();
    assert.equal(typeof sync.ok, 'boolean');
    // cleanup
    db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(res.id);
  } finally {
    __setEmbedOverride(null);
  }
});
