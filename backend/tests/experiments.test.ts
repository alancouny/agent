import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { experimentsRouter } from '../src/routes/experiments.js';

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/experiments', experimentsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

test('experiments: prompt is required', async () => {
  const res = await fetch(`${base}/experiments/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runs: [{ label: 'a', model: 'gpt-4o' }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /prompt is required/);
});

test('experiments: runs must be non-empty', async () => {
  const res = await fetch(`${base}/experiments/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hi', runs: [] }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /non-empty/);
});

test('experiments: caps runs at 6', async () => {
  const runs = Array.from({ length: 7 }, (_, i) => ({ label: `r${i}`, model: 'gpt-4o' }));
  const res = await fetch(`${base}/experiments/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hi', runs }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at most 6/);
});

test('experiments: every run needs a label', async () => {
  const res = await fetch(`${base}/experiments/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hi', runs: [{ label: '   ', model: 'gpt-4o' }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /label/);
});

test('experiments: run without API key returns structured failure (not 5xx)', async () => {
  // 无 OPENAI_API_KEY 时 AgentCore 立即失败（不联网）→ 结构完整、ok:false
  const res = await fetch(`${base}/experiments/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'say hi',
      runs: [{ label: 'no-key', model: 'gpt-4o' }],
      maxIterations: 1,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.runs) && body.runs.length === 1);
  const r = body.runs[0];
  assert.equal(r.label, 'no-key');
  assert.equal(r.ok, false);
  assert.equal(typeof r.durationMs, 'number');
  assert.equal(typeof r.totalTokens, 'number');
  assert.ok(typeof r.error === 'string' && r.error.length > 0);
  assert.ok('winners' in body);
});
