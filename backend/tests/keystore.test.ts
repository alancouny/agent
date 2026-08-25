import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileKeyStore, getKeyStore, _resetKeyStoreForTest } from '../src/security/keystore.js';

function tmpKeyFile(): string {
  return path.join(os.tmpdir(), `agent-key-test-${Math.random().toString(36).slice(2)}.key`);
}

test('FileKeyStore: generates on first call, persists & is stable afterwards', () => {
  const f = tmpKeyFile();
  process.env.AGENT_KEY_FILE = f;
  try {
    const store = new FileKeyStore();
    const first = store.getOrCreate();
    assert.equal(first.created, true, 'first call creates');
    assert.match(first.key, /^agent-/, 'key has agent- prefix');

    const second = store.getOrCreate();
    assert.equal(second.created, false, 'second call reuses');
    assert.equal(second.key, first.key, 'same key across calls');

    assert.equal(store.get(), first.key, 'get() returns persisted key');

    const stat = fs.statSync(f);
    assert.equal(stat.mode & 0o777, 0o600, 'key file is 0600');
  } finally {
    fs.rmSync(f, { force: true });
    delete process.env.AGENT_KEY_FILE;
  }
});

test('getKeyStore: uses FileKeyStore when OS keyring is absent (graceful fallback)', () => {
  _resetKeyStoreForTest();
  const store = getKeyStore();
  assert.ok(store instanceof FileKeyStore, 'falls back to file keystore without @napi-rs/keyring');
});
