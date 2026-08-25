import { Router, Request, Response } from 'express';
import { skillStore } from '../skills/store.js';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const skillsRouter = Router();

skillsRouter.get('/', (_req: Request, res: Response) => {
  try {
    const skills = skillStore.list();
    res.json({ skills, count: skills.length });
  } catch (err: unknown) {
    logError(logger, 'skills:list', err);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

skillsRouter.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, when, steps } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const skill = skillStore.add({
      name,
      description: description || '',
      when: when || '',
      steps: Array.isArray(steps) ? steps : (typeof steps === 'string' ? steps.split('\n').filter(Boolean) : []),
    });
    res.status(201).json({ skill });
  } catch (err: unknown) {
    logError(logger, 'skills:add', err);
    res.status(500).json({ error: 'Failed to add skill' });
  }
});

skillsRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'when', 'steps']) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    const skill = skillStore.update(String(req.params.id), patch);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    res.json({ skill });
  } catch (err: unknown) {
    logError(logger, 'skills:update', err);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

skillsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const ok = skillStore.remove(String(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Skill not found' });
    res.json({ ok: true });
  } catch (err: unknown) {
    logError(logger, 'skills:delete', err);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});
