/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { getDb } from '../../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import { sessionEvents } from '../../session/events.js';
import type { SessionEvent } from '../../session/events.js';

export const sessionsRouter = Router();

// ── Full-text search across messages (LIKE, no extra deps) ──
sessionsRouter.get('/search', (req, res) => {
  const q = (req.query.q as string) || '';
  const sid = req.query.sessionId as string | undefined;
  if (!q.trim()) return res.status(400).json({ error: 'q is required' });
  const db = getDb();
  const like = `%${q}%`;
  const rows = sid
    ? db.prepare(`SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 50`)
      .all(sid, like)
    : db.prepare(`SELECT id, session_id, role, content, created_at FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT 50`)
      .all(like);
  res.json({ results: (rows as { id: string; session_id: string; role: string; content: string; created_at: string }[]).map((r) => ({ ...r, content: r.content.slice(0, 500) })) });
});

// ── Fork a session: copy its messages into a new session ──
sessionsRouter.post('/fork', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const db = getDb();
  const src = db.prepare('SELECT id, title, model, provider FROM sessions WHERE id = ?').get(sessionId) as { id: string; title?: string; model?: string; provider?: string } | undefined;
  if (!src) return res.status(404).json({ error: 'session not found' });
  const newId = uuidv4();
  db.prepare('INSERT INTO sessions (id, title, model, provider) VALUES (?, ?, ?, ?)')
    .run(newId, `${src.title || 'Session'} (fork)`, src.model, src.provider);
  const srcMessages = db
    .prepare('SELECT role, content, tool_calls, tool_call_id, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as { role: string; content: string; tool_calls: string | null; tool_call_id: string | null; created_at: string }[];
  const insertMsg = db.prepare(
    `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows: { role: string; content: string; tool_calls: string | null; tool_call_id: string | null; created_at: string }[]) => {
    for (const m of rows) insertMsg.run(uuidv4(), newId, m.role, m.content, m.tool_calls, m.tool_call_id, m.created_at);
  });
  insertMany(srcMessages);
  res.json({ newSessionId: newId });
});

// ── Token usage totals for a session ──
sessionsRouter.get('/tokens', (req, res) => {
  const sid = req.query.sessionId as string | undefined;
  if (!sid) return res.status(400).json({ error: 'sessionId required' });
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total_tokens),0) AS total, COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion FROM usage_log WHERE session_id = ?`
    )
    .get(sid) as { total: number; prompt: number; completion: number } | undefined;
  res.json({ tokens: row });
});

// ── Trajectory: the Harness-style "what the model saw" replay, from the session log ──
sessionsRouter.get('/trajectory', (req, res) => {
  const sid = req.query.sessionId as string | undefined;
  if (!sid) return res.status(400).json({ error: 'sessionId required' });
  const events = sessionEvents.list(sid);

  // Group by turn → steps for the UI.
  const turns = new Map<number, { turnIdx: number; steps: Map<number, SessionEvent[]>; events: SessionEvent[] }>();
  const order: number[] = [];
  for (const ev of events) {
    if (!turns.has(ev.turnIdx)) {
      turns.set(ev.turnIdx, { turnIdx: ev.turnIdx, steps: new Map(), events: [] });
      order.push(ev.turnIdx);
    }
    const t = turns.get(ev.turnIdx)!;
    t.events.push(ev);
    if (!t.steps.has(ev.stepIdx)) t.steps.set(ev.stepIdx, []);
    t.steps.get(ev.stepIdx)!.push(ev);
  }

  res.json({
    sessionId: sid,
    events,
    turns: order.map((idx) => {
      const t = turns.get(idx)!;
      return {
        turnIdx: t.turnIdx,
        steps: Array.from(t.steps.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([stepIdx, evs]) => ({ stepIdx, events: evs })),
      };
    }),
  });
});

// ── Steering: queue a user message that the running agent injects before its next step ──
sessionsRouter.post('/steer', async (req, res) => {
  const { sessionId, message: content } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (!content || !String(content).trim()) return res.status(400).json({ error: 'message required' });
  try {
    await sessionEvents.append({
      sessionId,
      turnIdx: 0,
      stepIdx: 0,
      type: 'steer',
      role: 'user',
      content: String(content),
    });
  } catch { /* steer logging is best-effort */ }
  res.json({ ok: true });
});
