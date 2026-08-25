import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveWorkspaceRoot,
  resolvePath,
  listDirectory,
  readFileContent,
  writeFileContent,
  deletePath,
  WorkspaceAccessError,
  MAX_FILE_SIZE,
} from '../src/workspace/fs.js';

let root: string;

test.before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('workspace: write + read round-trip', async () => {
  const rel = 'a/b/c.txt';
  await writeFileContent(root, rel, 'hello world');
  const res = await readFileContent(root, rel);
  assert.equal(res.content, 'hello world');
  assert.equal(res.encoding, 'utf-8');
});

test('workspace: nested directory creation happens automatically', async () => {
  await writeFileContent(root, 'deep/nested/dir/file.md', 'x');
  assert.ok(fs.existsSync(path.join(root, 'deep', 'nested', 'dir', 'file.md')));
});

test('workspace: listDirectory sorts dirs first, then files', async () => {
  await writeFileContent(root, 'zfile.txt', 'z');
  await writeFileContent(root, 'adir/inner.txt', 'i');
  const { items } = await listDirectory(root, '.');
  const first = items[0];
  assert.equal(first.type, 'directory', 'directory listed before files');
  const dirs = items.filter((i) => i.type === 'directory').map((i) => i.name);
  const files = items.filter((i) => i.type === 'file').map((i) => i.name);
  assert.ok(dirs.includes('adir'), 'adir is listed as a directory');
  assert.ok(files.includes('zfile.txt'), 'file listed after dirs');
});

test('workspace: deletePath removes files', async () => {
  await writeFileContent(root, 'delete-me.txt', 'bye');
  const res = await deletePath(root, 'delete-me.txt');
  assert.ok(res.path);
  assert.ok(!fs.existsSync(path.join(root, 'delete-me.txt')));
});

test('workspace: path traversal is rejected (EACCES_ROOT)', async () => {
  await assert.rejects(
    () => writeFileContent(root, '../../escape.txt', 'x'),
    (err: any) => err instanceof WorkspaceAccessError && err.code === 'EACCES_ROOT'
  );
});

test('workspace: sibling directory outside root is rejected', async () => {
  const sibling = path.join(path.dirname(root), 'ws-sibling-' + Date.now());
  fs.mkdirSync(sibling, { recursive: true });
  try {
    await assert.rejects(
      () => writeFileContent(root, path.relative(root, path.join(sibling, 'x.txt')), 'x'),
      (err: any) => err.code === 'EACCES_ROOT' || err.code === 'ENOTFILE'
    );
  } finally {
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('workspace: oversize files are rejected (ETOOLARGE)', async () => {
  const big = 'x'.repeat(MAX_FILE_SIZE + 1);
  await assert.rejects(
    () => writeFileContent(root, 'big.txt', big),
    (err: any) => err instanceof WorkspaceAccessError && err.code === 'ETOOLARGE'
  );
});

test('workspace: symlink dir pointing outside root is rejected (realpath)', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-outside-'));
  const linkDir = path.join(root, 'evil-link');
  fs.symlinkSync(outside, linkDir);
  try {
    // write through the symlinked dir (new file) must be rejected
    await assert.rejects(
      () => writeFileContent(root, 'evil-link/owned.txt', 'x'),
      (err: any) => err instanceof WorkspaceAccessError && err.code === 'EACCES_ROOT'
    );
    // read through the symlinked dir must be rejected
    await assert.rejects(
      () => readFileContent(root, 'evil-link/secret.txt'),
      (err: any) => err instanceof WorkspaceAccessError && err.code === 'EACCES_ROOT'
    );
    // delete through the symlinked dir must be rejected
    await assert.rejects(
      () => deletePath(root, 'evil-link/secret.txt'),
      (err: any) => err instanceof WorkspaceAccessError && err.code === 'EACCES_ROOT'
    );
    // listing the symlinked dir must be rejected
    await assert.rejects(
      () => listDirectory(root, 'evil-link'),
      (err: any) => err instanceof WorkspaceAccessError && err.code === 'EACCES_ROOT'
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('workspace: file symlink pointing outside root is rejected on read', async () => {
  // /etc/hosts exists on macOS/Linux and definitely lies outside the temp workspace.
  const link = path.join(root, 'etc-hosts-link');
  fs.symlinkSync('/etc/hosts', link);
  await assert.rejects(
    () => readFileContent(root, 'etc-hosts-link'),
    (err: any) => err instanceof WorkspaceAccessError && err.code === 'EACCES_ROOT'
  );
});

test('workspace: symlink within the workspace still resolves (no over-blocking)', async () => {
  await writeFileContent(root, 'real.txt', 'inside');
  const link = path.join(root, 'alias.txt');
  fs.symlinkSync(path.join(root, 'real.txt'), link);
  const res = await readFileContent(root, 'alias.txt');
  assert.equal(res.content, 'inside');
});
