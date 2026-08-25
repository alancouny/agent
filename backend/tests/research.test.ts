import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getDb } from '../src/db/database.js';
import { ingestDrift, driftState } from '../src/telemetry/drift.js';
import { parseCostEstimate, saveCostEstimate, listCostEstimates, calibrationBins } from '../src/telemetry/metacog.js';
import { recordLesson } from '../src/memory/lessons.js';
import { localMemoryProvider } from '../src/memory/local.js';
import { driftRouter } from '../src/routes/drift.js';
import { metacogRouter } from '../src/routes/metacog.js';

// ── drift ──
test('drift: similar topics score low, sudden topic change spikes', () => {
  const sid = `drift-${Date.now()}`;
  for (const msg of ['tell me about the ACS model', 'how does ACS handle adaptive compute', 'ACS training dynamics explained']) {
    ingestDrift(sid, msg);
  }
  // 稳定话题下分数应低
  const stable = ingestDrift(sid, 'more details about ACS adaptive compute states');
  assert.ok(stable < 0.4, `expected low drift, got ${stable}`);
  // 突转话题 → 高分 + 事件
  const spike = ingestDrift(sid, '今天晚餐吃什么，推荐个川菜馆');
  assert.ok(spike > 0.5, `expected drift spike, got ${spike}`);
  const state = driftState(sid);
  assert.ok(state.events >= 1);
  assert.ok(state.count >= 5);
});

test('drift: hashing embedding is deterministic and normalized', async () => {
  const { hashEmbed } = await import('../src/telemetry/drift.js');
  const a = hashEmbed('hello world hello');
  const b = hashEmbed('hello world hello');
  const c = hashEmbed('completely different topic here');
  assert.deepEqual(a, b);
  const normA = Math.sqrt(a.reduce((x, y) => x + y * y, 0));
  assert.ok(Math.abs(normA - 1) < 1e-6, 'L2 normalized');
  assert.ok(a.some((v, i) => Math.abs(v - c[i]) > 0.01), 'different text → different vector');
});

// ── metacognition ──
test('metacog: parseCostEstimate handles JSON and prose forms', () => {
  assert.deepEqual(parseCostEstimate('COST_ESTIMATE: {"predictedToolCalls": 3, "predictedTokens": 1500} then answer...'), {
    predictedToolCalls: 3,
    predictedTokens: 1500,
  });
  assert.deepEqual(parseCostEstimate('COST_ESTIMATE: 2 tool calls, 800 tokens'), {
    predictedToolCalls: 2,
    predictedTokens: 800,
  });
  assert.deepEqual(parseCostEstimate('{"predicted_tool_calls": 5, "predicted_tokens": 2000}'), {
    predictedToolCalls: 5,
    predictedTokens: 2000,
  });
  assert.equal(parseCostEstimate('no estimate here'), null);
  assert.equal(parseCostEstimate(''), null);
});

test('metacog: save/list/calibration roundtrip', () => {
  getDb().prepare("DELETE FROM cost_estimates WHERE session_id = ?").run('mc-test');
  saveCostEstimate({ sessionId: 'mc-test', model: 'gpt-4o', predictedToolCalls: 2, predictedTokens: 1000, actualToolCalls: 4, actualTokens: 3000 });
  saveCostEstimate({ sessionId: 'mc-test', model: 'gpt-4o', predictedToolCalls: 4, predictedTokens: 2000, actualToolCalls: 5, actualTokens: 5000 });
  const list = listCostEstimates('mc-test');
  assert.equal(list.length, 2);
  // created_at 秒级精度，同秒插入顺序不稳定 → 按预测值集合断言
  assert.deepEqual(list.map((e) => e.predictedTokens).sort(), [1000, 2000]);
  const bins = calibrationBins(list);
  assert.ok(bins.length >= 1);
  assert.ok(bins.every((b) => b.n >= 1 && b.predicted > 0 && b.actual > 0));
});

// ── lessons（经验回放）──
test('lessons: recordLesson writes tagged memory entry', async () => {
  getDb().prepare("DELETE FROM global_memories WHERE tags LIKE '%lesson%'").run();
  await recordLesson('ls-test', ['tool web_search failed: timeout', 'max iterations reached']);
  const entries = await localMemoryProvider.list(100);
  const lesson = entries.find((e) => (e.tags ?? []).includes('lesson'));
  assert.ok(lesson, 'lesson entry should exist');
  assert.ok(lesson.tags!.includes('replay'));
  assert.ok(lesson.content.includes('web_search failed'));
});

// ── HTTP ──
let server: any;
let base: string;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/drift', driftRouter);
  app.use('/api/metacog', metacogRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});
test.after(() => server?.close());

test('http: drift ingest + state', async () => {
  const sid = `http-drift-${Date.now()}`;
  const r = await fetch(`${base}/drift/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, text: 'how does the ACS model work' }),
  });
  assert.equal(r.status, 200);
  assert.ok('score' in (await r.json()));
  const st = await (await fetch(`${base}/drift?sessionId=${sid}`)).json();
  assert.equal(st.count, 1);
});

test('http: metacog estimates endpoint', async () => {
  const res = await fetch(`${base}/metacog/estimates`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.estimates));
  assert.ok(Array.isArray(body.calibration));
});
