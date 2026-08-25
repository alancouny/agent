import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// AC-R4-4：审批开关持久化——重启（关闭并重新打开 DB）后仍返回重启前的值。
// 本文件使用真实文件库：在首次加载 database.ts 前把 AGENT_DB_PATH 指向临时文件
// （preload.mjs 的 :memory: 仅作为默认，动态导入发生在覆盖之后）。
test('R4: approval setting persists across DB reopen (AC-R4-4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-persist-'));
  const dbFile = path.join(tmpDir, 'agent.db');
  process.env.AGENT_DB_PATH = dbFile;

  const dbMod = await import('../src/db/database.js');
  const settingsMod = await import('../src/db/settings.js');

  // 第一次“进程”：写入 false
  const db1 = dbMod.getDb();
  const before = db1.prepare(`SELECT value FROM app_settings WHERE key = 'approval.required'`).get() as
    | { value: string }
    | undefined;
  assert.equal(before, undefined, 'fresh DB has no approval.required row (default true)');
  settingsMod.settingsStore.set('approval.required', false);
  const written = db1.prepare(`SELECT value FROM app_settings WHERE key = 'approval.required'`).get() as
    | { value: string }
    | undefined;
  assert.ok(written, 'row written to DB');
  assert.equal(JSON.parse(written.value), false);

  // 模拟进程重启：关闭连接后重新打开同一文件
  dbMod.closeDb();
  const db2 = dbMod.getDb();
  const after = db2.prepare(`SELECT value FROM app_settings WHERE key = 'approval.required'`).get() as
    | { value: string }
    | undefined;
  assert.ok(after, 'row survives DB reopen');
  assert.equal(JSON.parse(after.value), false, 'persisted value is false');
  assert.ok(Number(db2.pragma('user_version', { simple: true })) >= 1, 'migration version applied');

  dbMod.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
