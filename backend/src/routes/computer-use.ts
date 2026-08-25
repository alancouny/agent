import { Router, Request, Response } from 'express';
import { computerUseManager, CPU_SERVER_SCRIPT } from '../computer-use/manager.js';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const cpuRouter = Router();

// GET /api/computer-use/status — Check Computer Use status
cpuRouter.get('/status', (_req: Request, res: Response) => {
  const status = computerUseManager.getStatus();
  res.json(status);
});

// POST /api/computer-use/start — Start MCP server
cpuRouter.post('/start', (_req: Request, res: Response) => {
  try {
    const result = computerUseManager.startServer();
    res.json({
      ...result,
      status: result.success ? 'running' : 'error',
      script: CPU_SERVER_SCRIPT,
    });
  } catch (e: unknown) {
    logError(logger, 'computer-use:start', e);
    res.status(500).json({ success: false, error: 'Failed to start computer use server' });
  }
});

// POST /api/computer-use/stop — Stop MCP server
cpuRouter.post('/stop', (_req: Request, res: Response) => {
  try {
    const result = computerUseManager.stopServer();
    res.json(result);
  } catch (e: unknown) {
    logError(logger, 'computer-use:stop', e);
    res.status(500).json({ success: false, error: 'Failed to stop computer use server' });
  }
});

// GET /api/computer-use/tools — List available tools
cpuRouter.get('/tools', (_req: Request, res: Response) => {
  const status = computerUseManager.getStatus();
  res.json({
    tools: status.tools,
    count: status.tools.length,
    status: status.status,
  });
});