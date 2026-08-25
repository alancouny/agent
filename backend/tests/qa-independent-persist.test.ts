// ============================================================
// QA 独立验证：AC-R4-4 审批开关持久化（真实文件库 + 进程重启模拟）。
//
// 注意：本文件必须在首次 import 任何 src 模块前把 AGENT_DB_PATH
// 指向临时文件（preload.mjs 的 :memory: 只作为默认），因此所有
// src 模块均为 test 体内的动态 import。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('QA-R4-4: approvalRequired persists across DB reopen + fresh registry load (AC-R4-4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-approval-persist-'));
  const dbFile = path.join(tmpDir, 'agent.db');
  process.env.AGENT_DB_PATH = dbFile;

  const dbMod = await import('../src/db/database.js');
  const settingsMod = await import('../src/db/settings.js');
  const regMod = await import('../src/tools/registry.js');

  try {
    // 新库默认 true
    assert.equal(regMod.isApprovalRequired(), true, 'fresh DB defaults to approval required');

    // 通过公共 setter（API 内部同一入口）关闭审批
    regMod.setApprovalRequired(false);
    assert.equal(regMod.isApprovalRequired(), false);

    // 落库断言
    const row = dbMod.getDb()
      .prepare(`SELECT value FROM app_settings WHERE key = 'approval.required'`)
      .get() as { value: string } | undefined;
    assert.ok(row, 'app_settings row written');
    assert.equal(JSON.parse(row.value), false, 'persisted value is false');

    // 模拟进程重启：关闭连接 → 重新打开同一文件
    dbMod.closeDb();
    const db2 = dbMod.getDb();
    assert.ok(Number(db2.pragma('user_version', { simple: true })) >= 2, 'migrations applied');

    // 重启后：全新 SettingsStore 实例（空缓存）从 DB 读回 false
    const freshSettings = await import('../src/db/settings.js?restart=' + Date.now());
    assert.equal(
      freshSettings.settingsStore.get('approval.required', true),
      false,
      'fresh settings store reads persisted false from DB'
    );

    // 重启后：全新 registry 模块加载时读到 false（approvalRequired 初始化路径）
    const freshReg = await import('../src/tools/registry.js?restart=' + Date.now());
    assert.equal(freshReg.isApprovalRequired(), false, 'fresh registry load sees persisted false');

    // 经 HTTP API 视角（同进程复用 serverApp 场景下）也应一致：
    // 此处直接验证持久化值等价于 API 读取源（isApprovalRequired 由 settingsStore 驱动）。
    assert.equal(freshReg.isApprovalRequired(), freshSettings.settingsStore.get('approval.required', true));
  } finally {
    dbMod.closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
