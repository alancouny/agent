import { Router, Request, Response } from 'express';
import {
  createTask,
  createStep,
  getTask,
  getSteps,
  listTasks,
  updateTaskStatus,
  updateTaskProgress,
  updateStepStatus,
  deleteTask,
  pauseTask,
  resumeTask,
  completeTask,
  failTask,
} from '../tasks/tasks.js';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const tasksRouter = Router();

function pid(req: Request, key: string): string {
  return Array.isArray(req.params[key]) ? req.params[key]![0] : (req.params[key] as string);
}

// GET /api/tasks
tasksRouter.get('/', (req: Request, res: Response) => {
  try {
    const { sessionId, status } = req.query;
    const tasks = listTasks(typeof sessionId === 'string' ? sessionId : undefined, typeof status === 'string' ? status : undefined);
    const result = tasks.map(task => ({ ...task, steps: getSteps(task.id) }));
    res.json({ tasks: result, count: result.length });
  } catch (err: unknown) {
    logError(logger, 'tasks:list', err);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// GET /api/tasks/:id
tasksRouter.get('/:id', (req, res) => {
  try {
    const task = getTask(pid(req, 'id'));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task, steps: getSteps(task.id) });
  } catch (err: unknown) {
    logError(logger, 'tasks:get', err);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

// POST /api/tasks
tasksRouter.post('/', (req, res) => {
  try {
    const { title, description, sessionId } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const task = createTask(title, description || '', sessionId);
    res.status(201).json({ task, steps: getSteps(task.id) });
  } catch (err: unknown) {
    logError(logger, 'tasks:create', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// DELETE /api/tasks/:id
tasksRouter.delete('/:id', (req, res) => {
  if (deleteTask(pid(req, 'id'))) res.json({ ok: true });
  else res.status(404).json({ error: 'Task not found' });
});

// POST /api/tasks/:id/status
tasksRouter.post('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'planning', 'running', 'paused', 'completed', 'failed'];
    if (!status || !valid.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const task = updateTaskStatus(pid(req, 'id'), status);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task, steps: getSteps(task.id) });
  } catch (err: unknown) {
    logError(logger, 'tasks:status', err);
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

// POST /api/tasks/:id/progress
tasksRouter.post('/:id/progress', (req, res) => {
  try {
    const { progress, currentStep } = req.body;
    if (typeof progress !== 'number') return res.status(400).json({ error: 'progress is required' });
    const id = pid(req, 'id');
    updateTaskProgress(id, progress, currentStep ?? 0);
    const task = getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task, steps: getSteps(task.id) });
  } catch (err: unknown) {
    logError(logger, 'tasks:progress', err);
    res.status(500).json({ error: 'Failed to update task progress' });
  }
});

tasksRouter.post('/:id/pause', (req, res) => {
  try {
    const task = pauseTask(pid(req, 'id'));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (err: unknown) {
    logError(logger, 'tasks:pause', err);
    res.status(500).json({ error: 'Failed to pause task' });
  }
});

tasksRouter.post('/:id/resume', (req, res) => {
  try {
    const task = resumeTask(pid(req, 'id'));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (err: unknown) {
    logError(logger, 'tasks:resume', err);
    res.status(500).json({ error: 'Failed to resume task' });
  }
});

tasksRouter.post('/:id/complete', (req, res) => {
  try {
    const task = completeTask(pid(req, 'id'));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (err: unknown) {
    logError(logger, 'tasks:complete', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

tasksRouter.post('/:id/fail', (req, res) => {
  try {
    const task = failTask(pid(req, 'id'));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (err: unknown) {
    logError(logger, 'tasks:fail', err);
    res.status(500).json({ error: 'Failed to fail task' });
  }
});

// POST /api/tasks/:taskId/steps
tasksRouter.post('/:taskId/steps', (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const task = getTask(pid(req, 'taskId'));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const order = getSteps(task.id).length;
    const step = createStep(task.id, title, description || '', order);
    res.status(201).json({ step, task: getTask(task.id), steps: getSteps(task.id) });
  } catch (err: unknown) {
    logError(logger, 'tasks:step:create', err);
    res.status(500).json({ error: 'Failed to create step' });
  }
});

// POST /api/tasks/task-steps/:stepId/status
tasksRouter.post('/task-steps/:stepId/status', (req, res) => {
  try {
    const { status, output } = req.body;
    const valid = ['pending', 'running', 'completed', 'failed', 'skipped'];
    if (!status || !valid.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const step = updateStepStatus(pid(req, 'stepId'), status, output);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    res.json({ step, task: getTask(step.taskId), steps: getSteps(step.taskId) });
  } catch (err: unknown) {
    logError(logger, 'tasks:step:status', err);
    res.status(500).json({ error: 'Failed to update step status' });
  }
});