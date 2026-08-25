// 会话漂移雷达 API：
//   GET  /api/drift?sessionId=   — 漂移历史 + 事件统计（不传 sessionId 返回全部会话）
//   POST /api/drift/ingest       — 手动摄入一条消息（agent 路由保存消息时也会自动摄入）
import { Router } from 'express';
import { ingestDrift, driftState } from '../telemetry/drift.js';

export const driftRouter = Router();

driftRouter.get('/', (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId ? req.query.sessionId : undefined;
  res.json(sessionId ? driftState(sessionId) : { sessions: driftState() });
});

driftRouter.post('/ingest', (req, res) => {
  const { sessionId, text } = req.body || {};
  if (!sessionId || !text) return res.status(400).json({ error: 'sessionId and text are required' });
  const score = ingestDrift(String(sessionId), String(text));
  res.json({ score: Number(score.toFixed(3)), sessionId });
});
