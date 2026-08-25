// ============================================================
// Git workflow — quick status / branches / log / commit / branch ops.
// 全部经 execFile('git', [...args]) 直调，不经过 shell，规避注入；
// 仅允许在「项目根」（后端进程目录的父目录）内部操作。
// ============================================================

import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';
import { assertWithinRoot } from '../workspace/fs.js';

const execFileP = promisify(execFile);
export const gitRouter = Router();

// Git 面板作用于项目根（backend/ 的父目录）及其内部仓库；
// git 操作本身只读 + 显式 commit/branch，放宽到项目根是合理边界。
const PROJECT_ROOT = resolve(process.cwd(), '..');

function rootOf(cwd?: unknown): string {
  if (typeof cwd === 'string' && cwd.trim()) {
    const target = resolve(cwd.trim());
    // 词法 + realpath 双重校验：经 symlink cwd 指向项目根外的 git 仓库一律拒绝
    // （如 .git-test/link → /tmp/external-repo），统一走 fs.assertWithinRoot。
    return assertWithinRoot(PROJECT_ROOT, target);
  }
  return PROJECT_ROOT;
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; code?: number }> {
  try {
    const { stdout, stderr } = await execFileP('git', args, { cwd, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e: unknown) {
    logError(logger, 'git:run', e);
    const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
    return { ok: false, stdout: (err.stdout || '').trim(), stderr: (err.stderr || err.message || '').trim(), code: err.code };
  }
}

/** 状态概览：当前分支 + 变更清单（含暂存状态）。 */
gitRouter.get('/status', async (req, res) => {
  let cwd: string;
  try { cwd = rootOf(req.query.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  const branch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const porcelain = await runGit(cwd, ['status', '--porcelain=v1', '--branch']);
  if (!branch.ok && !porcelain.ok) {
    // 非 git 仓库：返回友好标记而非 4xx，面板可提示用户
    return res.json({
      cwd,
      branch: null,
      changes: [],
      summary: {},
      total: 0,
      notRepository: true,
      detail: porcelain.stderr || branch.stderr,
      timestamp: new Date().toISOString(),
    });
  }
  const changes = porcelain.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const staged = line.slice(0, 2).trim();
      const file = line.slice(3);
      const rename = file.match(/^(.*) -> (.*)$/);
      return {
        status: staged || '??',
        staged: staged !== '' && staged !== '??',
        path: rename ? rename[2] : file,
        oldPath: rename ? rename[1] : undefined,
      };
    });
  const summary = changes.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  res.json({
    cwd,
    branch: branch.ok ? branch.stdout : null,
    changes,
    summary,
    total: changes.length,
    timestamp: new Date().toISOString(),
  });
});

gitRouter.get('/branches', async (req, res) => {
  let cwd: string;
  try { cwd = rootOf(req.query.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  const r = await runGit(cwd, ['branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)']);
  if (!r.ok) return res.status(400).json({ error: 'Not a git repository', detail: r.stderr });
  const branches = r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream] = line.split('|');
      return { name, current: head === '*', upstream: upstream || undefined };
    });
  res.json({ branches });
});

gitRouter.get('/log', async (req, res) => {
  let cwd: string;
  try { cwd = rootOf(req.query.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  const n = Math.min(Number(req.query.n) || 20, 100);
  const r = await runGit(cwd, ['log', '--pretty=format:%h%x1f%H%x1f%s%x1f%an%x1f%ad', '--date=short', '-n', String(n)]);
  if (!r.ok) return res.status(400).json({ error: 'Not a git repository', detail: r.stderr });
  const commits = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [short, hash, subject, author, date] = line.split('\x1f');
    return { short, hash, subject, author, date };
  });
  res.json({ commits });
});

gitRouter.get('/diff', async (req, res) => {
  let cwd: string;
  try { cwd = rootOf(req.query.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  const file = typeof req.query.path === 'string' && req.query.path ? [req.query.path] : [];
  const args = ['diff', '--no-color', '--stat', ...file];
  const stat = await runGit(cwd, args);
  const bodyArgs = ['diff', '--no-color', ...file];
  const body = await runGit(cwd, bodyArgs);
  res.json({ stat: stat.stdout, diff: body.stdout });
});

/** 一键提交：可选 add -A；仅允许常规 commit（不 push，避免误操作）。 */
gitRouter.post('/commit', async (req, res) => {
  const { message, addAll } = req.body || {};
  let cwd: string;
  try { cwd = rootOf(req.body?.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  // execFile 不经过 shell：message 里的引号/分号无注入风险
  if (addAll) {
    const add = await runGit(cwd, ['add', '-A']);
    if (!add.ok) return res.status(400).json({ error: 'git add failed', detail: add.stderr });
  }
  const commit = await runGit(cwd, ['commit', '-m', message]);
  if (!commit.ok) return res.status(400).json({ error: 'git commit failed', detail: commit.stderr });
  const head = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  res.json({ ok: true, hash: head.stdout, output: commit.stdout });
});

/** 创建并切换到新分支。 */
gitRouter.post('/branch', async (req, res) => {
  const { name } = req.body || {};
  let cwd: string;
  try { cwd = rootOf(req.body?.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(name)) {
    return res.status(400).json({ error: 'invalid branch name (letters, digits, _ . / -)' });
  }
  const checkout = await runGit(cwd, ['checkout', '-b', name]);
  if (!checkout.ok) return res.status(400).json({ error: 'git checkout -b failed', detail: checkout.stderr });
  res.json({ ok: true, branch: name });
});

gitRouter.post('/checkout', async (req, res) => {
  const { branch } = req.body || {};
  let cwd: string;
  try { cwd = rootOf(req.body?.cwd); } catch (e: unknown) { return res.status(400).json({ error: (e as { message?: string }).message || "Invalid path" }); }
  if (!branch || typeof branch !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(branch)) {
    return res.status(400).json({ error: 'invalid branch name' });
  }
  const r = await runGit(cwd, ['checkout', branch]);
  if (!r.ok) return res.status(400).json({ error: 'git checkout failed', detail: r.stderr });
  res.json({ ok: true, branch });
});
