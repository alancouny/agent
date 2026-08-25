import express from 'express';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const healthRouter = express.Router();

healthRouter.get('/', (req, res) => {
  try {
    res.status(200).json({
      status: 'ok',
      message: 'AI Agent Backend is running',
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    logError(logger, 'health:check', err);
    res.status(500).json({ error: 'Health check failed' });
  }
});
