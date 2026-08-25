// ============================================================
// Workflow routes — expose the LangGraph-style StateGraph
// (backend/src/workflow/*) over HTTP.
//
//   POST /api/workflow/run   — run the supervisor workflow for a
//                              user message, SSE-streaming events
//   GET  /api/workflow/graph — describe the graph (nodes/edges)
//                              for debugging/UI
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig } from '../agent/types.js';
import { buildSupervisorWorkflow } from '../workflow/graph.js';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';
import { makeInitialState } from '../workflow/types.js';
import { loadMessages, saveUserMessage, saveAssistantMessage } from '../session/messages.js';
import { getModelContextWindow } from './model_provider.js';
import '../tools/builtin.js';
import '../computer-use/register-tools.js';
import '../tasks/agent-tools.js';
import '../tools/system-tools.js';
import '../tools/agent-meta-tools.js';

export const workflowRouter = Router();

workflowRouter.post('/run', async (req: Request, res: Response) => {
  const { message, sessionId, model, provider, baseUrl, apiKey, systemPrompt = '', thinkingMode = false } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const sid = sessionId || uuidv4();
  const db = getDb();

  // Create session if new (also covers a client-supplied id that isn't persisted yet)
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sid);
  if (!existing) {
    db.prepare(`INSERT INTO sessions (id, title, model, provider) VALUES (?, ?, ?, ?)`)
      .run(sid, String(message).substring(0, 50), model || 'gpt-4o', provider || 'openai');
  }
  saveUserMessage(sid, String(message));

  const config: AgentConfig = {
    provider: provider || 'openai',
    model: model || 'gpt-4o',
    baseUrl: baseUrl || process.env.OPENAI_BASE_URL || undefined,
    apiKey: apiKey || process.env.OPENAI_API_KEY || undefined,
    maxIterations: 25,
    maxTokens: 4096,
    temperature: 0.7,
    systemPrompt: systemPrompt || '',
    contextWindow: getModelContextWindow(provider || 'openai', model || 'gpt-4o'),
    thinkingMode: !!thinkingMode,
  };

  // Resume prior context like /chat does.
  const history = loadMessages(sid);
  const graph = buildSupervisorWorkflow();
  let finalText = '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // 客户端断连即中止工作流；心跳注释行保活（配合前端空闲超时兜底）
  const abort = new AbortController();
  const clientGone = () => abort.abort();
  res.on('close', clientGone);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);
  const cleanUp = () => {
    clearInterval(heartbeat);
    res.removeListener('close', clientGone);
  };
  const streamState = makeInitialState({
    sessionId: sid,
    config: { ...config, signal: abort.signal },
    messages: history,
    userMessage: String(message),
  });

  try {
    for await (const ev of graph.run(streamState)) {
      res.write(`data: ${JSON.stringify({ ...ev, sessionId: sid })}\n\n`);
      if (ev.type === 'text' && ev.content) finalText += ev.content;
      if (abort.signal.aborted) break;
    }
    cleanUp();
    if (!abort.signal.aborted) {
      // Ensure the UI stops its "thinking" state even when the graph ended silently.
      res.write(`data: ${JSON.stringify({ type: 'complete', sessionId: sid })}\n\n`);
      saveAssistantMessage(sid, finalText);
      res.write(`data: ${JSON.stringify({ type: 'done', sessionId: sid })}\n\n`);
      res.end();
    }
  } catch (err: unknown) {
    logError(logger, 'workflow:run', err);
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : String(err));
    cleanUp();
    if (!abort.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: message, sessionId: sid })}\n\n`);
      res.end();
    }
  }
});

/** Describe the built graph (node ids + edges) — useful for debugging and the UI. */
workflowRouter.get('/graph', (_req, res) => {
  buildSupervisorWorkflow();
  res.json({
    entryPoint: 'router',
    nodes: ['router', 'supervisor', 'delegate', 'complete', 'error'],
    edges: [
      { from: 'router', to: 'supervisor', edge: 'loop' },
      { from: 'router', to: 'delegate', edge: 'delegate' },
      { from: 'router', to: 'complete', edge: 'complete' },
      { from: 'router', to: 'error', edge: 'error' },
      { from: 'supervisor', to: 'router', edge: 'loop' },
      { from: 'supervisor', to: 'complete', edge: 'done' },
      { from: 'supervisor', to: 'error', edge: 'error' },
      { from: 'delegate', to: 'complete', edge: 'complete' },
      { from: 'delegate', to: 'error', edge: 'error' },
      { from: 'complete', to: '__end__' },
      { from: 'error', to: '__end__' },
    ],
    graphType: 'StateGraph (LangGraph-style)',
  });
});
