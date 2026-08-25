import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pluginsRouter, loadPlugins } from '../src/routes/plugins.js';

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', pluginsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
  // 加载真实示例插件（backend/plugins/geek-demo.js）
  await loadPlugins();
});

test.after(() => server?.close());

test('plugins: loads geek-demo from backend/plugins', async () => {
  const res = await fetch(`${base}/plugins`);
  assert.equal(res.status, 200);
  const { plugins, count } = await res.json();
  assert.equal(count, plugins.length);
  const demo = plugins.find((p: any) => p.name === 'geek-demo');
  assert.ok(demo, 'geek-demo should be loaded');
  assert.ok(demo.commands.includes('fortune'));
  assert.ok(demo.commands.includes('fib'));
  assert.deepEqual(demo.hooks, []);
});

test('plugins: run command works', async () => {
  const res = await fetch(`${base}/plugins/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: 'geek-demo', command: 'fib', args: ['8'] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.output, /fib\(8\) = \[0, 1, 1, 2, 3, 5, 8, 13\]/);
});

test('plugins: unknown plugin returns 404', async () => {
  const res = await fetch(`${base}/plugins/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: 'nope', command: 'x' }),
  });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /plugin not found/);
});

test('plugins: unknown command returns 404', async () => {
  const res = await fetch(`${base}/plugins/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: 'geek-demo', command: 'nope' }),
  });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /command not found/);
});

test('plugins: reload keeps plugins', async () => {
  const res = await fetch(`${base}/plugins/reload`, { method: 'POST' });
  assert.equal(res.status, 200);
  const { ok, count } = await res.json();
  assert.equal(ok, true);
  assert.ok(count >= 1);
});
