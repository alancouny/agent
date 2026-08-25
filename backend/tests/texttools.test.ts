import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { textToolsRouter } from '../src/routes/texttools.js';

let server: any;
let base: string;

// 文本工具作用于项目根；测试用 backend 子树（与路由的 PROJECT_ROOT 一致）
const PROJECT_ROOT = process.cwd();

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/texttools', textToolsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

test('texttools: search finds matches in the repo', async () => {
  // cwd 收窄到 backend 子树（快速且覆盖真实代码路径）
  const res = await fetch(`${base}/texttools/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern: 'gitRouter', cwd: process.cwd() }),
  });
  assert.equal(res.status, 200);
  const { count, results } = await res.json();
  assert.ok(count >= 1, 'should find gitRouter references');
  assert.ok(results.some((r: any) => r.file.includes('src/routes/git.ts')));
  assert.ok(results.every((r: any) => typeof r.line === 'number'));
});

test('texttools: search invalid regex returns 400', async () => {
  const res = await fetch(`${base}/texttools/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern: '(', cwd: PROJECT_ROOT }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid regex/);
});

test('texttools: search rejects paths escaping project root', async () => {
  const res = await fetch(`${base}/texttools/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern: 'x', cwd: '/tmp' }),
  });
  assert.equal(res.status, 400);
});

test('texttools: replace dry-run never modifies files', async () => {
  const target = 'src/routes/git.ts';
  const before = await readFile(`${PROJECT_ROOT}/${target}`, 'utf-8');
  const res = await fetch(`${base}/texttools/replace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pattern: 'zzz_definitely_no_match_zzz',
      replacement: 'zzz',
      files: [target],
      cwd: PROJECT_ROOT,
      dryRun: true,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.total, 0);
  assert.equal(body.applied.length, 0);
  const after = await readFile(`${PROJECT_ROOT}/${target}`, 'utf-8');
  assert.equal(after, before, 'file must be untouched by dry-run');
});

test('texttools: replace dry-run reports per-file previews', async () => {
  const res = await fetch(`${base}/texttools/replace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pattern: 'gitRouter',
      replacement: 'gitRouterXX',
      files: ['src/routes/git.ts'],
      cwd: PROJECT_ROOT,
      dryRun: true,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.total >= 1);
  assert.ok(body.previews.length >= 1);
  assert.ok(body.previews[0].file.includes('git.ts'));
  assert.ok('before' in body.previews[0] && 'after' in body.previews[0]);
});

test('texttools: rename rejects path separators in new name', async () => {
  const res = await fetch(`${base}/texttools/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: PROJECT_ROOT,
      files: [{ path: 'src/routes/git.ts', newName: 'evil/../x.ts' }],
    }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid new name/);
});

test('texttools: rename rejects empty files list', async () => {
  const res = await fetch(`${base}/texttools/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: PROJECT_ROOT, files: [] }),
  });
  assert.equal(res.status, 400);
});

// ── symlink escape hardening（与 workspace/fs.ts 的 realpath 校验一致）──

test('texttools: search skips external files reached via symlink (realpath)', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TEXTTOOLS_ESCAPE_MARKER_XYZ');
  const ws = fs.mkdtempSync(path.join(PROJECT_ROOT, '.tt-test-'));
  fs.symlinkSync(outside, path.join(ws, 'link'));
  try {
    const res = await fetch(`${base}/texttools/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'TEXTTOOLS_ESCAPE_MARKER', files: ['link/secret.txt'], cwd: ws }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 0, 'external file via symlink must not be read');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('texttools: replace execute does not rewrite external file via symlink', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-outside-'));
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'SECRET_MARKER_123');
  const ws = fs.mkdtempSync(path.join(PROJECT_ROOT, '.tt-test-'));
  fs.symlinkSync(outside, path.join(ws, 'link'));
  try {
    const res = await fetch(`${base}/texttools/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: 'SECRET_MARKER',
        replacement: 'PWNED',
        files: ['link/victim.txt'],
        cwd: ws,
        dryRun: false,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.applied.length, 0, 'external file must not be rewritten');
    assert.equal(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf-8'), 'SECRET_MARKER_123');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('texttools: rename rejects a symlink-escape target', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-outside-'));
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'x');
  const ws = fs.mkdtempSync(path.join(PROJECT_ROOT, '.tt-test-'));
  fs.symlinkSync(outside, path.join(ws, 'link'));
  try {
    const res = await fetch(`${base}/texttools/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: ws, files: [{ path: 'link/victim.txt', newName: 'renamed.txt' }] }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /path/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
