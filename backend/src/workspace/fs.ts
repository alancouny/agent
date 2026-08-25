import { readFile, stat, readdir, writeFile, mkdir, unlink, rm } from 'fs/promises';
import { realpathSync } from 'fs';
import { join, basename, extname, dirname } from 'path';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

const BINARY_EXTS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc',
  '.mp3', '.mp4', '.avi', '.mkv', '.wav', '.ogg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.sqlite', '.db',
]);

/**
 * Thrown when a path resolves outside the workspace root, or when a file
 * operation fails in a way the HTTP layer needs to map to a status code.
 * `code` mirrors Node's fs error codes (ENOENT, EACCES, ENOTEMPTY, ...)
 * plus the custom `EACCES_ROOT` for path-escape attempts.
 */
export class WorkspaceAccessError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

/**
 * Resolve the active workspace root.
 * Priority: explicit `override` (e.g. ?root= query) → WORKSPACE_ROOT env → cwd.
 *
 * 安全约束：`override` 只允许指向配置工作区内部（== base 或 base 的子目录），
 * 杜绝通过 ?root=/ 之类把整个文件系统设为工作区根。
 */
export function resolveWorkspaceRoot(override?: string): string {
  const base = process.env.WORKSPACE_ROOT || process.cwd();
  if (override && override.trim()) {
    const target = override.trim();
    if (target === base || withinRoot(base, target)) return target;
    throw new WorkspaceAccessError(
      'Access denied: workspace root must be inside the configured workspace',
      'EACCES_ROOT'
    );
  }
  return base;
}

/**
 * True only when `target` is the root itself or a strict descendant of it.
 * Uses a trailing-slash check so a sibling dir like `/projectX` is rejected,
 * unlike a naive `startsWith(root)` guard.
 */
export function withinRoot(root: string, target: string): boolean {
  const nRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const nTarget = target.replace(/\\/g, '/');
  return nTarget === nRoot || nTarget.startsWith(nRoot + '/');
}

/**
 * Resolve the *real* path of `target`, following symlinks, so a workspace-internal
 * symlink pointing outside (e.g. link → /etc) cannot smuggle file operations out
 * of the workspace.
 *
 * For non-existent targets (e.g. writing a brand-new file) the parent directory is
 * resolved instead and the basename re-appended — this still catches symlinked
 * intermediate directories (root/link/newfile where root/link → /etc).
 */
function resolveRealPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    // Target doesn't exist yet; resolve the nearest existing ancestor and re-append
    // the missing segments so symlinked intermediate dirs are still resolved.
    const missing: string[] = [];
    let cur = dirname(target);
    for (;;) {
      try {
        const real = realpathSync(cur);
        return missing.length ? join(real, ...missing.reverse()) : real;
      } catch {
        const parent = dirname(cur);
        if (parent === cur) return target; // filesystem root reached — give up resolving
        missing.push(basename(cur));
        cur = parent;
      }
    }
  }
}

/**
 * Unified realpath-hardened containment check (converges fs.resolvePath /
 * git.rootOf / texttools.rootOf — ARCH_REVIEW #5).
 *
 * Verifies BOTH the lexical path and the symlink-resolved real path stay inside
 * `root`, throwing WorkspaceAccessError (EACCES_ROOT) otherwise. Returns the
 * lexical `target` on success (callers keep using the lexical path for actual
 * fs operations, consistent with `resolvePath`).
 */
export function assertWithinRoot(root: string, target: string): string {
  if (!withinRoot(root, target)) {
    throw new WorkspaceAccessError('Access denied: path escapes workspace root', 'EACCES_ROOT');
  }
  const realTarget = resolveRealPath(target);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // Workspace root missing is not an escape — keep the lexical root for comparison.
    realRoot = root;
  }
  if (!withinRoot(realRoot, realTarget)) {
    throw new WorkspaceAccessError('Access denied: path resolves outside workspace root (symlink)', 'EACCES_ROOT');
  }
  return target;
}

export function resolvePath(root: string, relPath: string): string {
  const target = relPath.startsWith('/') ? relPath : join(root, relPath);
  return assertWithinRoot(root, target);
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export async function listDirectory(
  root: string,
  relPath: string
): Promise<{ path: string; root: string; items: FileEntry[] }> {
  const target = resolvePath(root, relPath);
  const entries = await readdir(target, { withFileTypes: true });
  let realRoot = root;
  try { realRoot = realpathSync(root); } catch { /* keep lexical root */ }
  const items = await Promise.all(
    entries.map(async (entry): Promise<FileEntry> => {
      const full = join(target, entry.name);
      let size: number | undefined;
      let modified: string | undefined;
      try {
        // Symlink entries: never stat (or leak metadata of) targets that resolve
        // outside the workspace.
        if (entry.isSymbolicLink()) {
          const real = resolveRealPath(full);
          if (!withinRoot(realRoot, real)) return { name: entry.name, type: 'file' };
        }
        const s = await stat(full);
        size = s.size;
        modified = s.mtime.toISOString();
      } catch {
        /* symlink / permission issue — skip stats */
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size,
        modified,
      };
    })
  );
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: target, root, items };
}

export async function readFileContent(
  root: string,
  relPath: string
): Promise<{ content: string; encoding: 'utf-8' | 'base64'; size: number; name: string; ext: string }> {
  const target = resolvePath(root, relPath);
  const stats = await stat(target);
  if (!stats.isFile()) throw new WorkspaceAccessError('Not a file', 'ENOTFILE');
  if (stats.size > MAX_FILE_SIZE) throw new WorkspaceAccessError('File too large (max 5 MB)', 'ETOOLARGE');

  const ext = extname(target).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    const buf = await readFile(target);
    return { content: buf.toString('base64'), encoding: 'base64', size: stats.size, name: basename(target), ext };
  }
  const content = await readFile(target, 'utf-8');
  return { content, encoding: 'utf-8', size: stats.size, name: basename(target), ext };
}

export async function writeFileContent(
  root: string,
  relPath: string,
  content: string,
  encoding?: 'utf-8' | 'base64'
): Promise<{ path: string }> {
  const target = resolvePath(root, relPath);
  // 与 readFileContent 对称：写入同样受 MAX_FILE_SIZE 保护，避免超大内容落盘。
  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
  if (bytes.byteLength > MAX_FILE_SIZE) {
    throw new WorkspaceAccessError(`File too large (max ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)} MB)`, 'ETOOLARGE');
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { path: target };
}

export async function deletePath(root: string, relPath: string): Promise<{ path: string }> {
  const target = resolvePath(root, relPath);
  const stats = await stat(target);
  if (stats.isDirectory()) await rm(target, { recursive: true, force: true });
  else await unlink(target);
  return { path: target };
}
