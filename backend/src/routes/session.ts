import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const sessionRouter = Router();

// List sessions
sessionRouter.get('/', (_req, res) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`SELECT id, title, model, provider, created_at, updated_at, summary
      FROM sessions ORDER BY updated_at DESC LIMIT 50`).all();
    res.json({ sessions });
  } catch (err: unknown) {
    logError(logger, 'session:list', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Create session
sessionRouter.post('/', (req, res) => {
  try {
    const { model, provider, title } = req.body;
    const id = uuidv4();
    const db = getDb();
    db.prepare(`INSERT INTO sessions (id, title, model, provider) VALUES (?, ?, ?, ?)`)
      .run(id, title || 'New Session', model || 'gpt-4o', provider || 'openai');
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    res.json({ session });
  } catch (err: unknown) {
    logError(logger, 'session:create', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get session messages（支持可选 ?limit= 供未来分页；默认返回全部，保持现有行为）
sessionRouter.get('/:id/messages', (req, res) => {
  try {
    const db = getDb();
    const limit = Number(req.query.limit);
    const hasLimit = Number.isFinite(limit) && limit > 0;
    const messages = db
      .prepare(
        hasLimit
          ? `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`
          : `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id, ...(hasLimit ? [Math.floor(limit)] : []));
    res.json({ messages });
  } catch (err: unknown) {
    logError(logger, 'session:messages', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Delete session
sessionRouter.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    logError(logger, 'session:delete', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Get audit logs
sessionRouter.get('/:id/audit', (req, res) => {
  try {
    const db = getDb();
    const logs = db.prepare(`SELECT * FROM audit_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(req.params.id);
    res.json({ logs });
  } catch (err: unknown) {
    logError(logger, 'session:audit', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Get memories
sessionRouter.get('/:id/memories', (req, res) => {
  try {
    const db = getDb();
    const memories = db.prepare(`SELECT * FROM memories WHERE session_id = ? ORDER BY importance DESC, accessed_at DESC`)
      .all(req.params.id);
    res.json({ memories });
  } catch (err: unknown) {
    logError(logger, 'session:memories:list', err);
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
});

// Store memory
sessionRouter.post('/:id/memories', (req, res) => {
  try {
    const { type, content, summary, importance } = req.body;
    const db = getDb();
    const id = uuidv4();
    db.prepare(`INSERT INTO memories (id, session_id, type, content, summary, importance) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, req.params.id, type || 'semantic', content, summary || '', importance || 0.5);
    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    res.json({ memory });
  } catch (err: unknown) {
    logError(logger, 'session:memories:add', err);
    res.status(500).json({ error: 'Failed to store memory' });
  }
});