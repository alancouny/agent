/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { getDb } from '../../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import { getModelContextWindow } from '../model_provider.js';

export const contextRouter = Router();

// Token-estimation heuristic (shared with the compressor)
const TOKEN_CHARS = 3.8;
const estTokens = (text: string): number => {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return Math.ceil(cjk / 1 + (text.length - cjk) / TOKEN_CHARS);
};

// ── Context Compression API ──────────────────────────────────────────────────
contextRouter.get('/state', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const db = getDb();
  const msgs = db
    .prepare(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId as string) as { role: string; content: string }[];
  const totalTokens = msgs.reduce((s, m) => s + estTokens(m.content), 0);
  const contextWindow = getModelContextWindow('openai', 'gpt-4o') || 128000;
  const recentTurns = Math.floor(msgs.filter(m => m.role === 'user').length / 2);
  res.json({
    sessionId,
    messageCount: msgs.length,
    estimatedTokens: totalTokens,
    contextWindow,
    usageRatio: totalTokens / contextWindow,
    recentTurns,
    needsCompression: totalTokens / contextWindow > 0.7,
  });
});

contextRouter.post('/compress', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const db = getDb();
  const msgs = db
    .prepare(`SELECT id, role, content, tool_calls, tool_call_id, name FROM messages WHERE session_id = ? AND role != 'system' ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId) as { id: string; role: string; content: string; tool_calls: string | null; tool_call_id: string | null; name: string | null }[];
  if (msgs.length <= 4) {
    return res.json({ compressed: false, reason: 'too few messages' });
  }
  // Simple compression: replace oldest half with a summary block
  const half = Math.floor(msgs.length / 2);
  const older = msgs.slice(0, half);
  const beforeTokens = msgs.reduce((s, m) => s + estTokens(m.content), 0);
  const summaryBlock = `--- Earlier context (summarized) ---\n${older.map(m => `${m.role}: ${m.content.slice(0, 150)}`).join('\n')}\n--- End summary ---`;
  // Replace older messages with summary in DB（事务批量删除，避免逐条 + 中断残留）
  const idsToDelete = older.map(m => m.id).filter(Boolean) as string[];
  if (idsToDelete.length > 0) {
    const del = db.prepare(`DELETE FROM messages WHERE id = ?`);
    db.transaction((ids: string[]) => {
      for (const id of ids) del.run(id);
    })(idsToDelete);
  }
  // Insert summary as a user message to preserve the conversation flow
  const summaryId = uuidv4();
  db.prepare(`INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)`).run(
    summaryId, sessionId, summaryBlock
  );
  const afterMsgs = db
    .prepare(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId) as { role: string; content: string }[];
  const afterTokens = afterMsgs.reduce((s, m) => s + estTokens(m.content), 0);
  res.json({
    compressed: true,
    beforeTokens,
    afterTokens,
    savings: beforeTokens - afterTokens,
    originalCount: msgs.length,
    newCount: afterMsgs.length,
  });
});
