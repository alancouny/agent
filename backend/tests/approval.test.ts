import test from 'node:test';
import assert from 'node:assert/strict';
import { app as serverApp, ensureApiKey } from '../src/server.js';
import { getDb } from '../src/db/database.js';

let server: any;
let base: string;
let key: string;

test.before(async () => {
  key = ensureApiKey(); // 无 AGENT_API_KEY → 生成随机 key（决策 A）
  await new Promise<void>((resolve) => {
    server = serverApp.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extra };
}

function auditRows(): { input: string; output: string }[] {
  const db = getDb();
  return db
    .prepare(`SELECT input, output FROM audit_logs WHERE event_type = 'approval_toggle' ORDER BY created_at`)
    .all() as { input: string; output: string }[];
}

// AC-R4-1：无鉴权调用必须 401/403，且开关值不变
test('R4: unauthenticated approval requests are rejected with 401 (AC-R4-1)', async () => {
  const getRes = await fetch(`${base}/agent/settings/approval`);
  assert.equal(getRes.status, 401);

  const postRes = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, confirm: true }),
  });
  assert.equal(postRes.status, 401);
});

// AC-R4-2：关闭审批不带 confirm → 400 且开关不变
test('R4: disabling approval without confirm returns 400 and keeps toggle unchanged (AC-R4-2)', async () => {
  const res = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /confirm/i);

  const getRes = await fetch(`${base}/agent/settings/approval`, { headers: authHeaders() });
  const getBody = await getRes.json();
  assert.equal(getBody.approvalRequired, true, 'toggle unchanged after rejected request');
});

// AC-R4-3：成功变更写 audit_logs（approval_toggle）；失败尝试也记录
test('R4: successful toggles are audited with approval_toggle records (AC-R4-3)', async () => {
  // 关闭：必须 confirm
  const off = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ enabled: false, confirm: true }),
  });
  assert.equal(off.status, 200);
  let body = await off.json();
  assert.equal(body.approvalRequired, false);

  // 打开：无需 confirm（打开是安全方向）
  const on = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(on.status, 200);
  body = await on.json();
  assert.equal(body.approvalRequired, true);

  const rows = auditRows();
  // 期望 3 条：rejected（上一条用例缺 confirm）+ ok 关闭 + ok 打开；401 尝试不落库（全局 auth 层拦截）
  assert.equal(rows.length, 3, `expected 3 audit rows, got ${rows.length}`);

  const okOff = rows.find((r) => {
    const o = JSON.parse(r.output) as { result: string; to: boolean };
    return o.result === 'ok' && o.to === false;
  });
  assert.ok(okOff, 'ok:disable audit row exists');
  const okOffOut = JSON.parse(okOff.output) as { from: boolean; to: boolean; result: string };
  assert.equal(okOffOut.from, true);
  assert.equal(okOffOut.to, false);
  assert.equal(okOffOut.result, 'ok');

  const okOn = rows.find((r) => {
    const o = JSON.parse(r.output) as { result: string; to: boolean };
    return o.result === 'ok' && o.to === true;
  });
  assert.ok(okOn, 'ok:enable audit row exists');

  const rejected = rows.find((r) => {
    const o = JSON.parse(r.output) as { result: string };
    return o.result === 'rejected';
  });
  assert.ok(rejected, 'rejected audit row exists');
  const rejOut = JSON.parse(rejected.output) as { reason: string | null };
  assert.equal(rejOut.reason, 'missing confirm');

  // input 含请求方标识（actor = requestId|ip）
  const okOffIn = JSON.parse(okOff.input) as { enabled: boolean; confirm: boolean; actor: string };
  assert.equal(okOffIn.enabled, false);
  assert.equal(okOffIn.confirm, true);
  assert.ok(okOffIn.actor.includes('|'), `actor includes req.ip separator: ${okOffIn.actor}`);
});
