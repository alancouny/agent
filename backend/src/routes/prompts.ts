import express from 'express';
import { promptStore } from '../prompts/store.js';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const promptsRouter = express.Router();

promptsRouter.get('/', (_req, res) => {
  try {
    res.json({ prompts: promptStore.list() });
  } catch (err: unknown) {
    logError(logger, 'prompts:list', err);
    res.status(500).json({ error: 'Failed to list prompts' });
  }
});

promptsRouter.post('/', (req, res) => {
  try {
    const { name, content } = req.body || {};
    if (!name || !content) return res.status(400).json({ error: 'name and content required' });
    res.json({ prompt: promptStore.add(name, content) });
  } catch (err: unknown) {
    logError(logger, 'prompts:add', err);
    res.status(500).json({ error: 'Failed to add prompt' });
  }
});

promptsRouter.put('/:id', (req, res) => {
  try {
    const { name, content } = req.body || {};
    if (!name || !content) return res.status(400).json({ error: 'name and content required' });
    const updated = promptStore.update(req.params.id, name, content);
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json({ prompt: updated });
  } catch (err: unknown) {
    logError(logger, 'prompts:update', err);
    res.status(500).json({ error: 'Failed to update prompt' });
  }
});

promptsRouter.delete('/:id', (req, res) => {
  try {
    const ok = promptStore.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err: unknown) {
    logError(logger, 'prompts:delete', err);
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});
