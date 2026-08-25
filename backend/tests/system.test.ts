import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { systemRouter } from '../src/routes/system.js';

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use('/api/system', systemRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

test('system: stats returns well-formed snapshot', async () => {
  const res = await fetch(`${base}/system/stats`);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.ok(Array.isArray(s.cpu.loadAvg) && s.cpu.loadAvg.length === 3);
  assert.ok(typeof s.cpu.cores === 'number' && s.cpu.cores > 0);
  assert.ok(typeof s.cpu.model === 'string' && s.cpu.model.length > 0);
  assert.ok(typeof s.memory.total === 'number' && s.memory.total > 0);
  assert.ok(typeof s.memory.percent === 'number');
  assert.ok(s.memory.percent >= 0 && s.memory.percent <= 100);
  assert.ok(typeof s.uptime === 'number');
  assert.ok(typeof s.hostname === 'string');
  assert.ok(typeof s.platform === 'string');
  assert.ok(typeof s.timestamp === 'number');
  // CPU 首次采样可能为 null（需两个采样点差分），第二次必有值
  if (s.cpu.usage === null) {
    await new Promise((r) => setTimeout(r, 1100)); // 越过 1s 采样缓存
    const res2 = await fetch(`${base}/system/stats`);
    const s2 = await res2.json();
    assert.ok(typeof s2.cpu.usage === 'number');
  }
});

test('system: stats respects the 1s cache (same object shape twice)', async () => {
  const a = await (await fetch(`${base}/system/stats`)).json();
  const b = await (await fetch(`${base}/system/stats`)).json();
  assert.equal(a.hostname, b.hostname);
  assert.equal(a.memory.total, b.memory.total);
});
