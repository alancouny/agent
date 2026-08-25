import { Router, Request, Response } from 'express';
import { executeCommand } from '../computer-use/handlers.js';
import { assertSafeCommand, sanitizeErrorMessage } from '../utils/safeCommand.js';
import { logError } from '../utils/error-mask.js';
import { logger } from '../utils/logger.js';

export const terminalRouter = Router();

// POST /api/terminal/execute
terminalRouter.post('/execute', async (req: Request, res: Response) => {
  const { command, cwd, timeout } = req.body;
  if (!command) return res.status(400).json({ error: 'command is required' });

  // Guard against shell injection: reject metacharacters and shell wrappers
  try {
    assertSafeCommand(command);
  } catch (err: unknown) {
    logError(logger, 'terminal:assert', err);
    return res.status(400).json({ error: sanitizeErrorMessage(err) });
  }

  let result: { success: boolean; output: string };
  try {
    result = await executeCommand({ command, cwd: cwd || undefined, timeout: timeout || 30 });
  } catch (err: unknown) {
    logError(logger, 'terminal:execute', err);
    return res.json({ success: false, output: sanitizeErrorMessage(err), command, cwd: cwd || process.cwd(), timestamp: new Date().toISOString() });
  }

  res.json({
    success: result.success,
    output: result.output,
    command,
    cwd: cwd || process.cwd(),
    timestamp: new Date().toISOString(),
  });
});