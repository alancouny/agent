/**
 * Issue1 验证：append() 失败时必须让 next Promise 变为 rejected，
 * 而非 resolve 为错误值（否则 await 方不会抛异常，错误被静默忽略）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/db/database.js';
import { sessionEvents } from '../src/session/events.js';

function ensureSession(sid: string): void {
  const db = getDb();
  if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(sid)) {
    db.prepare(`INSERT INTO sessions (id, title, model, provider) VALUES (?, ?, ?, ?)`)
      .run(sid, 'test-session', 'gpt-4o', 'openai');
  }
}

test('concurrent appends: seq must be strictly increasing 1..20', async () => {
  const sid = `test-concurrent-${Date.now()}`;
  ensureSession(sid);
  // 同一 tick 内发起 20 个并发 append，屏障必须让它们严格串行执行
  const promises = Array.from({ length: 20 }, (_, i) =>
    sessionEvents.append({ sessionId: sid, type: 'text' as any, content: `msg-${i}` })
  );
  const results = await Promise.all(promises);
  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1), 'seq must be exactly 1..20, no duplicates');
});

test('failed append must reject, not resolve with error value', async () => {
  const sid = `test-reject-${Date.now()}`;
  ensureSession(sid);

  // 使用不存在的 sessionId 触发 FK 约束失败（不插入该行，让约束真正生效）
  const fakeSid = `nonexistent-session-${Date.now()}`;

  const result = sessionEvents.append({ sessionId: fakeSid, type: 'text' as any, content: 'fail' });

  // 关键验证：await 时必须抛出异常（即 promise 是 rejected），而不是拿到一个错误值
  let threw = false;
  let caughtValue: unknown;
  try {
    await result;
  } catch (e) {
    threw = true;
    caughtValue = e;
  }

  assert.ok(threw, 'append with invalid session must reject (throw), not resolve with error value');
  assert.ok(caughtValue instanceof Error || typeof caughtValue === 'object', 'must receive an actual error');
});

test('after failed append, subsequent appends still work (queue self-heals)', async () => {
  const sid = `test-selfheal-${Date.now()}`;
  ensureSession(sid);

  // 先发起一个会失败的 append（FK 约束），不 await 它（fire-and-forget）
  const failing = sessionEvents.append({
    sessionId: `ghost-${Date.now()}`,
    type: 'text' as any,
    content: 'will-fail',
  }).catch(() => {}); // 外部吞掉，不阻塞

  // 紧接着发起一个正常 append（应与 failing 并发，各自独立）
  const ok = await sessionEvents.append({ sessionId: sid, type: 'text' as any, content: 'ok' });
  assert.equal(ok.seq, 1, 'normal append must succeed even after a failed concurrent append');

  // 现在再等 failing settle（内部已 .catch(() => {}) 吞掉，不会传播）
  await failing;
});
