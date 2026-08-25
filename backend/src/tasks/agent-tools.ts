import { toolRegistry } from '../tools/registry.js';
import {
  createTask,
  createStep,
  updateStepStatus,
  updateTaskStatus,
  listTasks,
  getTask,
} from './tasks.js';

// ========== Create Task Tool ==========
toolRegistry.register('create_task', {
  schema: {
    name: 'create_task',
    description:
      'Create a tracked task for multi-step work so the user can follow progress in the Tasks panel. Returns the new task id. Use this when a request involves several steps.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'What the task aims to accomplish' },
      },
      required: ['title'],
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (args: any, ctx: any) => {
    const title = String(args.title || '').trim();
    if (!title) return { success: false, output: 'title is required', error: 'INVALID_ARGS' };
    const task = createTask(title, String(args.description || ''), ctx?.sessionId);
    return {
      success: true,
      output: `Created task "${task.title}" (id: ${task.id})`,
      data: task,
    };
  },
  category: 'tasks',
  requiresApproval: false,
  enabled: true,
});

// ========== Add Task Step Tool ==========
toolRegistry.register('add_task_step', {
  schema: {
    name: 'add_task_step',
    description: 'Add a planned step to an existing task. Returns the new step id and the task progress.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of the task returned by create_task' },
        title: { type: 'string', description: 'Short description of this step' },
        description: { type: 'string', description: 'Optional detail about the step' },
      },
      required: ['taskId', 'title'],
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (args: any) => {
    const taskId = String(args.taskId || '');
    const title = String(args.title || '').trim();
    if (!taskId || !title) return { success: false, output: 'taskId and title are required', error: 'INVALID_ARGS' };
    const task = getTask(taskId);
    if (!task) return { success: false, output: `Task ${taskId} not found`, error: 'NOT_FOUND' };
    const step = createStep(taskId, title, String(args.description || ''), 0);
    return {
      success: true,
      output: `Added step "${step.title}" to task "${task.title}"`,
      data: step,
    };
  },
  category: 'tasks',
  requiresApproval: false,
  enabled: true,
});

// ========== Update Task Step Tool ==========
toolRegistry.register('update_task_step', {
  schema: {
    name: 'update_task_step',
    description: 'Update the status of a task step as work progresses (running, completed, failed, skipped). Optionally include output. Task progress is auto-recomputed.',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: 'Id of the step returned by add_task_step' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'skipped'], description: 'New status' },
        output: { type: 'string', description: 'Optional result or note for this step' },
      },
      required: ['stepId', 'status'],
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (args: any) => {
    const stepId = String(args.stepId || '');
    const status = String(args.status || '');
    const valid = ['pending', 'running', 'completed', 'failed', 'skipped'];
    if (!stepId || !valid.includes(status)) {
      return { success: false, output: 'stepId and a valid status are required', error: 'INVALID_ARGS' };
    }
    const step = updateStepStatus(stepId, status as 'pending' | 'running' | 'completed' | 'failed' | 'skipped', args.output ? String(args.output) : undefined);
    if (!step) return { success: false, output: `Step ${stepId} not found`, error: 'NOT_FOUND' };
    return {
      success: true,
      output: `Step "${step.title}" is now ${step.status}`,
      data: step,
    };
  },
  category: 'tasks',
  requiresApproval: false,
  enabled: true,
});

// ========== List Tasks Tool ==========
toolRegistry.register('list_tasks', {
  schema: {
    name: 'list_tasks',
    description: 'List existing tasks for the current session, optionally filtered by status.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'planning', 'running', 'paused', 'completed', 'failed'], description: 'Optional status filter' },
      },
      required: [],
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (_args: any, ctx: any) => {
    const tasks = listTasks(ctx?.sessionId, _args?.status ? String(_args.status) : undefined);
    if (!tasks.length) return { success: true, output: 'No tasks found', data: [] };
    return {
      success: true,
      output: tasks.map(t => `- [${t.status}] ${t.title} (${t.progress}% done)`).join('\n'),
      data: tasks,
    };
  },
  category: 'tasks',
  requiresApproval: false,
  enabled: true,
});

// ========== Complete Task Tool ==========
toolRegistry.register('complete_task', {
  schema: {
    name: 'complete_task',
    description: 'Mark a task as completed (or failed) when all of its steps are done.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of the task' },
        status: { type: 'string', enum: ['completed', 'failed'], description: 'Final status' },
      },
      required: ['taskId', 'status'],
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (args: any) => {
    const taskId = String(args.taskId || '');
    const status = (args.status === 'failed' ? 'failed' : 'completed') as 'completed' | 'failed';
    const task = updateTaskStatus(taskId, status);
    if (!task) return { success: false, output: `Task ${taskId} not found`, error: 'NOT_FOUND' };
    return { success: true, output: `Task "${task.title}" marked ${task.status}`, data: task };
  },
  category: 'tasks',
  requiresApproval: false,
  enabled: true,
});
