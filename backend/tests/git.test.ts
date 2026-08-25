import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitRouter } from '../src/routes/git.js';

let server: any;
let base: string;

// 路由的 PROJECT_ROOT = resolve(process.cwd(), '..')；测试在 backend/ 下运行。
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/git', gitRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

test('git: status on a non-repository returns friendly marker (not 4xx)', async () => {
  // backend/ 不是 git 仓库 → 应返回 notRepository:true 而非报错
  const res = await fetch(`${base}/git/status?cwd=${encodeURIComponent(process.cwd())}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.notRepository, true);
  assert.equal(body.branch, null);
  assert.equal(body.total, 0);
});

test('git: status rejects cwd outside project root', async () => {
  const res = await fetch(`${base}/git/status?cwd=${encodeURIComponent('/tmp')}`);
  assert.equal(res.status, 400);
});

test('git: commit requires a message', async () => {
  const res = await fetch(`${base}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: process.cwd(), message: '   ' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /message is required/);
});

test('git: branch rejects invalid names', async () => {
  const res = await fetch(`${base}/git/branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: process.cwd(), name: 'evil;rm -rf /' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid branch name/);
});

test('git: checkout rejects invalid names', async () => {
  const res = await fetch(`${base}/git/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: process.cwd(), branch: 'a b c' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid branch name/);
});

test('git: status rejects a cwd that symlink-escapes the project root (realpath)', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'git-outside-'));
  const ws = fs.mkdtempSync(path.join(PROJECT_ROOT, '.git-test-'));
  fs.symlinkSync(outside, path.join(ws, 'link'));
  try {
    const res = await fetch(`${base}/git/status?cwd=${encodeURIComponent(path.join(ws, 'link'))}`);
    assert.equal(res.status, 400, 'symlink cwd pointing outside must be rejected');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
