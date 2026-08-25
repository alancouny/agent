import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileKeyStore, OsKeyStore, getKeyStore, _resetKeyStoreForTest } from '../src/security/keystore.js';

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

test('getKeyStore: prefers OS keyring when @napi-rs/keyring is installed', () => {
  // preload.mjs 默认设了 AGENT_KEY_STORE=file（测试隔离），此用例显式清除以验证钥匙串优先
  const prev = process.env.AGENT_KEY_STORE;
  delete process.env.AGENT_KEY_STORE;
  _resetKeyStoreForTest();
  try {
    const store = getKeyStore();
    assert.ok(store instanceof OsKeyStore, 'should use OS keyring backend when installed');
  } finally {
    _resetKeyStoreForTest();
    if (prev === undefined) delete process.env.AGENT_KEY_STORE;
    else process.env.AGENT_KEY_STORE = prev;
  }
});

test('getKeyStore: AGENT_KEY_STORE=file forces file keystore (test isolation)', () => {
  process.env.AGENT_KEY_STORE = 'file';
  _resetKeyStoreForTest();
  try {
    const store = getKeyStore();
    assert.ok(store instanceof FileKeyStore, 'should skip OS keyring when forced to file');
  } finally {
    delete process.env.AGENT_KEY_STORE;
    _resetKeyStoreForTest();
  }
});

test('OsKeyStore: gracefully falls back to FileKeyStore when keyring ops fail', () => {
  const f = tmpKeyFile();
  process.env.AGENT_KEY_FILE = f;
  try {
    // 模拟钥匙串不可用（权限拒绝 / 无 keychain）：Entry 构造或操作抛错
    const BrokenEntry = class {
      constructor() {
        throw new Error('keychain unavailable');
      }
      getPassword(): string | null {
        throw new Error('keychain unavailable');
      }
      setPassword(_pw: string): void {
        throw new Error('keychain unavailable');
      }
    };
    const store = new OsKeyStore({ Entry: BrokenEntry } as any);
    const r = store.getOrCreate();
    assert.equal(r.created, true, 'fallback still creates a key');
    assert.match(r.key, /^agent-/, 'key has agent- prefix');
    assert.equal(store.get(), r.key, 'fallback persisted to file store');
  } finally {
    fs.rmSync(f, { force: true });
    delete process.env.AGENT_KEY_FILE;
  }
});
