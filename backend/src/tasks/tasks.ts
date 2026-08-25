import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';

export interface Task {
  id: string;
  sessionId: string | null;
  title: string;
  description: string;
  status: 'pending' | 'planning' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number; // 0-100
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  order: number;
  output?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

function withDb<T>(fn: (db: Database.Database) => T): T {
  return fn(getDb());
}

export function createTask(
  title: string,
  description: string,
  sessionId?: string
): Task {
  return withDb((db) => {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO tasks (id, session_id, title, description, status, progress, total_steps)
       VALUES (?, ?, ?, ?, 'planning', 0, 0)`
    ).run(id, sessionId || null, title, description);
    return getTask(id)!;
  });
}

export function createStep(
  taskId: string,
  title: string,
  description: string,
  order: number
): TaskStep {
  return withDb((db) => {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO task_steps (id, task_id, title, description, status, \`order\`)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(id, taskId, title, description, order);

    // Update total steps on parent task
    const count = db.prepare(`SELECT COUNT(*) as c FROM task_steps WHERE task_id = ?`).get(taskId) as { c: number };
    db.prepare(`UPDATE tasks SET total_steps = ? WHERE id = ?`).run(count.c, taskId);

    return getStep(id)!;
  });
}

export function getTask(id: string): Task | undefined {
  return withDb((db) => {
    const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    if (!row) return undefined;
    return row as Task;
  });
}

export function getSteps(taskId: string): TaskStep[] {
  return withDb((db) => {
    return db.prepare(`SELECT * FROM task_steps WHERE task_id = ? ORDER BY \`order\` ASC`).all(taskId) as TaskStep[];
  });
}

export function listTasks(sessionId?: string, status?: string): Task[] {
  return withDb((db) => {
    let sql = `SELECT * FROM tasks`;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (sessionId) {
      conditions.push(`session_id = ?`);
      params.push(sessionId);
    }
    if (status) {
      conditions.push(`status = ?`);
      params.push(status);
    }
    if (conditions.length) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ` ORDER BY updated_at DESC`;
    return db.prepare(sql).all(...params) as Task[];
  });
}

export function updateTaskStatus(taskId: string, status: Task['status']): Task | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    let completedAt = null;
    if (status === 'completed' || status === 'failed') {
      completedAt = now;
    }
    db.prepare(
      `UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`
    ).run(status, now, completedAt, taskId);
    return getTask(taskId);
  });
}

export function updateTaskProgress(taskId: string, progress: number, currentStep: number): void {
  withDb((db) => {
    db.prepare(
      `UPDATE tasks SET progress = ?, current_step = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(Math.min(100, Math.max(0, progress)), currentStep, taskId);
  });
}

export function updateStepStatus(stepId: string, status: TaskStep['status'], output?: string): TaskStep | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    const step = db.prepare(`SELECT * FROM task_steps WHERE id = ?`).get(stepId) as TaskStep | undefined;
    if (!step) return undefined;

    db.prepare(
      `UPDATE task_steps SET status = ?, output = ?, started_at = ?, completed_at = ? WHERE id = ?`
    ).run(
      status,
      output || null,
      status === 'running' ? now : step.startedAt,
      status === 'completed' || status === 'failed' || status === 'skipped' ? now : null,
      stepId
    );

    // Update task progress based on completed steps
    const task = getTask(step.taskId);
    if (task) {
      const steps = getSteps(step.taskId);
      const completed = steps.filter(s => s.status === 'completed').length;
      const total = steps.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      updateTaskProgress(step.taskId, progress, completed);

      // Auto-advance task status
      if (progress === 100) {
        updateTaskStatus(step.taskId, 'completed');
      } else if (status === 'failed') {
        updateTaskStatus(step.taskId, 'failed');
      }
    }

    return getStep(stepId);
  });
}

export function getStep(id: string): TaskStep | undefined {
  return withDb((db) => {
    return db.prepare(`SELECT * FROM task_steps WHERE id = ?`).get(id) as TaskStep | undefined;
  });
}

export function deleteTask(taskId: string): boolean {
  return withDb((db) => {
    // Cascade delete task_steps first (foreign key CASCADE handles it in SQLite WAL, but be explicit)
    db.prepare(`DELETE FROM task_steps WHERE task_id = ?`).run(taskId);
    const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    return result.changes > 0;
  });
}

export function pauseTask(taskId: string): Task | undefined {
  return updateTaskStatus(taskId, 'paused');
}

export function resumeTask(taskId: string): Task | undefined {
  return updateTaskStatus(taskId, 'running');
}

export function completeTask(taskId: string): Task | undefined {
  return updateTaskStatus(taskId, 'completed');
}

export function failTask(taskId: string): Task | undefined {
  return updateTaskStatus(taskId, 'failed');
}