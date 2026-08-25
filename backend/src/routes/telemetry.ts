// LLM 调用追踪查询 — 瀑布图数据源。
//   GET /api/telemetry/llm-calls?sessionId=&limit=
import { Router } from 'express';
import { llmTracer } from '../telemetry/llm-trace.js';

export const telemetryRouter = Router();

telemetryRouter.get('/llm-calls', (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId ? req.query.sessionId : undefined;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const calls = llmTracer.list(sessionId, limit);
  res.json({ calls, count: calls.length });
});

telemetryRouter.delete('/llm-calls', (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId ? req.query.sessionId : undefined;
  llmTracer.clear(sessionId);
  res.json({ ok: true });
});
