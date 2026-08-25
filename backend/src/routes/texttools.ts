// ============================================================
// Text tools — regex search / bulk find-replace (dry-run first) /
// batch rename, scoped to the project root (backend/ 的父目录).
// ============================================================

import { Router } from 'express';
import { readdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assertWithinRoot, MAX_FILE_SIZE } from '../workspace/fs.js';
import { safeErrorMessage } from '../utils/error-mask.js';

export const textToolsRouter = Router();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'target']);
// 明显二进制 / 生成物扩展名：搜索语义是"文本"，避免大文件整读导致内存与 IO 爆炸
const SKIP_EXTS = new Set([
  '.rlib', '.rmeta', '.map', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.ttf', '.woff', '.woff2', '.pdf', '.zip', '.gz', '.svg', '.exe', '.dll',
  '.so', '.dylib', '.class', '.jar', '.pyc', '.lock',
]);
const MAX_FILE_TO_READ = 2 * 1024 * 1024; // 单文件 > 2MB 跳过
const MAX_FILES = 3000;
const MAX_MATCHES = 500;

// 文本工具作用于项目根（backend/ 的父目录）及其内部，便于搜索整个仓库。
const PROJECT_ROOT = resolve(process.cwd(), '..');

function rootOf(cwd?: unknown): string {
  if (typeof cwd === 'string' && cwd.trim()) {
    const target = resolve(cwd.trim());
    // 词法 + realpath 双重校验：工作区内指向外部的 symlink 不再能作为 cwd
    // （如 .tt-test/link → /tmp），统一走 fs.assertWithinRoot。
    return assertWithinRoot(PROJECT_ROOT, target);
  }
  return PROJECT_ROOT;
}

/** 递归收集可读文本文件（返回相对 root 的路径，跳过常见生成目录）。 */
async function walkFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  if (out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkFiles(root, full, out);
    } else if (e.isFile()) {
      const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase();
      if (SKIP_EXTS.has(ext)) continue;
      // 大文件跳过（编译产物/二进制），避免整读拖垮内存
      try {
        const st = await stat(full);
        if (st.size > MAX_FILE_TO_READ) continue;
      } catch {
        continue;
      }
      out.push(relative(root, full));
    }
  }
  return out;
}

/** 搜索：pattern 按正则解析，逐文件逐行匹配。 */
textToolsRouter.post('/search', async (req, res) => {
  const { pattern, cwd, caseSensitive, files } = req.body || {};
  let root: string;
  try { root = rootOf(cwd); } catch (e: unknown) { return res.status(400).json({ error: safeErrorMessage((e as { message?: string }).message || "Invalid path") }); }
  if (!pattern || typeof pattern !== 'string' || !pattern.trim()) {
    return res.status(400).json({ error: 'pattern is required' });
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch (e: unknown) {
    // 错误响应体脱敏（AC-R3-2）：pattern 为客户端输入，可能内含敏感串
    return res.status(400).json({ error: `invalid regex: ${safeErrorMessage(e)}` });
  }
  const targets = Array.isArray(files) && files.length
    ? files.filter((f: unknown) => typeof f === 'string')
    : await walkFiles(root);
  const results: { file: string; line: number; text: string }[] = [];
  for (const file of targets) {
    if (results.length >= MAX_MATCHES) break;
    // walkFiles 返回相对路径；外部传入的 files 也按相对路径处理
    const abs = join(root, file);
    // 词法 + realpath 校验：指向工作区外的 symlink 目标跳过（不读外部文件）
    try {
      assertWithinRoot(root, abs);
    } catch {
      continue;
    }
    try {
      const content = await readFile(abs, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < MAX_MATCHES; i++) {
        if (re.test(lines[i])) {
          results.push({ file: relative(root, abs), line: i + 1, text: lines[i].slice(0, 240) });
          re.lastIndex = 0; // 防 g 标志在逐行 test 时跨行漂移
        }
      }
    } catch { /* binary/unreadable → skip */ }
  }
  res.json({ results, count: results.length, truncated: results.length >= MAX_MATCHES, root });
});

/** 批量替换：dryRun 预览（每文件匹配数 + 首例替换前后），execute 落盘（原子写）。 */
textToolsRouter.post('/replace', async (req, res) => {
  const { pattern, replacement, cwd, files, dryRun = true } = req.body || {};
  let root: string;
  try { root = rootOf(cwd); } catch (e: unknown) { return res.status(400).json({ error: safeErrorMessage((e as { message?: string }).message || "Invalid path") }); }
  if (!pattern || typeof pattern !== 'string') return res.status(400).json({ error: 'pattern is required' });
  if (typeof replacement !== 'string') return res.status(400).json({ error: 'replacement is required' });
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'g');
  } catch (e: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    return res.status(400).json({ error: `invalid regex: ${safeErrorMessage(e)}` });
  }
  const targets = Array.isArray(files) && files.length
    ? files.filter((f: unknown) => typeof f === 'string')
    : await walkFiles(root);

  const previews: { file: string; count: number; before: string; after: string }[] = [];
  const applied: string[] = [];
  let total = 0;
  for (const file of targets) {
    const abs = join(root, file);
    // 词法 + realpath 校验：指向工作区外的 symlink 目标跳过（绝不改写外部文件）
    try {
      assertWithinRoot(root, abs);
    } catch {
      continue;
    }
    try {
      const original = await readFile(abs, 'utf-8');
      const replaced = original.replace(re, replacement);
      if (replaced === original) continue;
      re.lastIndex = 0;
      const count = (original.match(re) || []).length;
      total += count;
      if (dryRun) {
        const firstLine = original.split('\n').find((l) => re.test(l)) ?? '';
        re.lastIndex = 0;
        const afterFirst = firstLine.replace(re, replacement);
        previews.push({ file: relative(root, abs), count, before: firstLine.slice(0, 160), after: afterFirst.slice(0, 160) });
      } else {
        if (Buffer.byteLength(original, 'utf-8') > MAX_FILE_SIZE) continue;
        const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, replaced, 'utf-8');
        await rename(tmp, abs); // 原子写
        applied.push(relative(root, abs));
      }
    } catch { /* skip unreadable */ }
  }
  res.json({ dryRun, total, previews, applied, count: dryRun ? previews.length : applied.length });
});

/** 批量重命名：单文件操作，path 必须在 workspace 内且新名不含路径分隔符。 */
textToolsRouter.post('/rename', async (req, res) => {
  const { cwd, files } = req.body || {};
  let root: string;
  try { root = rootOf(cwd); } catch (e: unknown) { return res.status(400).json({ error: safeErrorMessage((e as { message?: string }).message || "Invalid path") }); }
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files is required' });
  }
  const done: { from: string; to: string }[] = [];
  for (const item of files) {
    const from = item?.path;
    const to = item?.newName;
    if (typeof from !== 'string' || typeof to !== 'string' || !to.trim()) continue;
    if (to.includes('/') || to.includes('\\') || to === '.' || to === '..') {
      return res.status(400).json({ error: `invalid new name: ${to}` });
    }
    const abs = join(root, from);
    // 词法 + realpath 校验：指向工作区外的 symlink 目标拒绝重命名（400 而非 500）
    let next: string;
    try {
      assertWithinRoot(root, abs);
      next = join(root, `${from.replace(/[^/]*$/, '')}${to}`);
    } catch (e: unknown) {
      const msg = safeErrorMessage(e instanceof Error ? e.message : 'path escapes workspace');
      return res.status(400).json({ error: msg });
    }
    await rename(abs, next);
    done.push({ from, to: `${from.replace(/[^/]*$/, '')}${to}` });
  }
  res.json({ ok: true, renamed: done });
});
