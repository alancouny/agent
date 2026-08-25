import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';
import {
  resolveWorkspaceRoot,
  listDirectory,
  readFileContent,
  writeFileContent,
  deletePath,
  WorkspaceAccessError,
} from '../workspace/fs.js';

export const workspaceRouter = Router();

function getRoot(req: Request): string {
  const override = typeof req.query.root === 'string' ? req.query.root : undefined;
  return resolveWorkspaceRoot(override);
}

/** Map a WorkspaceAccessError (or generic fs error) to an HTTP status + message. */
function httpError(err: unknown): { status: number; message: string } {
  if (err instanceof WorkspaceAccessError) {
    switch (err.code) {
      case 'EACCES_ROOT':
        // 响应脱敏（AC-R3-2）；safeErrorMessage 对我们自产消息为幂等
        return { status: 403, message: safeErrorMessage(err.message) };
      case 'ENOTFILE':
        return { status: 400, message: 'Not a file' };
      case 'ETOOLARGE':
        return { status: 413, message: safeErrorMessage(err.message) };
    }
  }
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ENOENT':
      return { status: 404, message: 'Not found' };
    case 'EACCES':
      return { status: 403, message: 'Permission denied' };
    case 'ENOTEMPTY':
      return { status: 400, message: 'Directory not empty' };
  }
  // 兜底 500 路径：任意上游/异常 message 进入响应前脱敏（AC-R3-2）
  const message = safeErrorMessage(err instanceof Error ? err.message : 'Internal error');
  return { status: 500, message };
}

// GET /api/workspace/root
workspaceRouter.get('/root', (_req: Request, res: Response) => {
  res.json({ root: getRoot(_req) });
});

// GET /api/workspace/files?path=<relative-or-absolute>
workspaceRouter.get('/files', async (req: Request, res: Response) => {
  try {
    const root = getRoot(req);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const result = await listDirectory(root, relPath);
    res.json(result);
  } catch (err) {
    logError(logger, 'workspace:list', err);
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});

// GET /api/workspace/files/read?path=<relative-or-absolute>
workspaceRouter.get('/files/read', async (req: Request, res: Response) => {
  try {
    const root = getRoot(req);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const result = await readFileContent(root, relPath);
    res.json(result);
  } catch (err) {
    logError(logger, 'workspace:read', err);
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});

// POST /api/workspace/files/write { path, content, encoding? }
workspaceRouter.post('/files/write', async (req: Request, res: Response) => {
  const { path: filePath, content, encoding } = req.body as {
    path?: string;
    content?: string;
    encoding?: 'utf-8' | 'base64';
  };
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'path and content are required' });
  }
  try {
    const root = getRoot(req);
    const { path } = await writeFileContent(root, filePath, content, encoding);
    res.json({ ok: true, path });
  } catch (err) {
    logError(logger, 'workspace:write', err);
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});

// POST /api/workspace/files/delete { path }
workspaceRouter.post('/files/delete', async (req: Request, res: Response) => {
  const { path: filePath } = req.body as { path?: string };
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  try {
    const root = getRoot(req);
    const { path } = await deletePath(root, filePath);
    res.json({ ok: true, path });
  } catch (err) {
    logError(logger, 'workspace:delete', err);
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});
