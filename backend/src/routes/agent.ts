/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { AgentCore } from '../agent/core.js';
import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig } from '../agent/types.js';
import { toolRegistry, executeTool, getToolApprovals, setApprovalWithTTL, isApprovalRequired, setApprovalRequired, logApprovalToggle } from '../tools/registry.js';
import { getModelContextWindow } from './model_provider.js';
import { ingestDrift } from '../telemetry/drift.js';
import { sessionEvents } from '../session/events.js';
import type { SessionEvent } from '../session/events.js';
import '../tools/builtin.js';
import '../computer-use/register-tools.js';
import '../tasks/agent-tools.js';
import '../tools/system-tools.js';
import '../tools/agent-meta-tools.js';

export const agentRouter = Router();

// 消息持久化单一实现（/chat 与 /workflow/run 共用）
import { loadMessages, saveUserMessage, saveAssistantMessage, ensureSession } from '../session/messages.js';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';
import { getRequestId } from '../utils/request-context.js';

const AUTO_RUN_INSTRUCTIONS = `
AUTO-RUN MODE ENABLED. For every user request, automatically manage task tracking using these tools:
1. First call create_task with a concise title describing the user's goal.
2. Then call add_task_step for each distinct step you plan to execute.
3. As you work, call update_task_step to mark steps running/completed with brief output.
4. When finished, call complete_task with status 'completed' (or 'failed' if something went wrong).

Do NOT ask the user for permission to create tasks — always do it automatically. Keep task titles short and steps concrete. Only create a task if the request is non-trivial (more than a simple one-liner answer); for trivial requests, answer directly without task tracking.`;

agentRouter.post('/chat', async (req: Request, res: Response) => {
  const { message, sessionId, model, provider, baseUrl, apiKey, stream = true, autoRun = false, thinkingMode = false } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const sid = sessionId || uuidv4();

  // Create session if new (also covers a client-supplied id that isn't persisted yet)
  ensureSession(sid, message, model || 'gpt-4o', provider || 'openai');

  // Save user message
  saveUserMessage(sid, message);
  // 漂移雷达：用户消息在线摄入（hashing embedding，失败不影响主流程）
  try { ingestDrift(sid, message); } catch { /* best-effort */ }

  const config: AgentConfig = {
    provider: provider || 'openai',
    model: model || 'gpt-4o',
    baseUrl: baseUrl || process.env.OPENAI_BASE_URL || undefined,
    apiKey: apiKey || process.env.OPENAI_API_KEY || undefined,
    maxIterations: 25,
    maxTokens: 4096,
    temperature: 0.7,
    systemPrompt: (req.body.systemPrompt || '') + (autoRun ? '\n\n' + AUTO_RUN_INSTRUCTIONS : ''),
    fallbacks: req.body.fallbacks || undefined,
    contextWindow: getModelContextWindow(provider || 'openai', model || 'gpt-4o'),
    thinkingMode: !!thinkingMode,
    // 全局长期记忆注入（前端 MemoryPanel 开关；默认关）
    memory: req.body.memoryInject ? { enabled: true, topK: Number(req.body.memoryTopK) || 4 } : undefined,
    metacognition: req.body.metacognition ? { enabled: true } : undefined,
  };

  // Resume prior context from the persisted messages (Harness: resume derives from the log).
  const history = loadMessages(sid);
  const agent = new AgentCore(config, sid, history);

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 客户端断连即中止 agent（LLM 调用间隙 / 循环头部检查 signal），避免后台继续烧 token 与执行工具
    const abort = new AbortController();
    const clientGone = () => abort.abort();
    res.on('close', clientGone);
    const streamAgent = new AgentCore({ ...config, signal: abort.signal }, sid, history);

    // 心跳注释行：SSE 规范保活，配合前端空闲超时兜底（代理/半开连接下探测断流）
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    let fullContent = '';
    const cleanUp = () => {
      clearInterval(heartbeat);
      res.removeListener('close', clientGone);
    };

    try {
      for await (const event of streamAgent.run(message)) {
        const data = JSON.stringify(event);
        res.write(`data: ${data}\n\n`);

        if (event.type === 'text') {
          fullContent += event.content;
        }
        if (abort.signal.aborted) break; // 断连后停止继续 yield/写 socket
      }

      cleanUp();

      // Save assistant message (with tool-call metadata so resume reconstructs the exact model input)
      if (fullContent && !abort.signal.aborted) {
        const lastAssistant = streamAgent.getMessages().slice().reverse().find((m) => m.role === 'assistant');
        saveAssistantMessage(sid, fullContent, lastAssistant?.tool_calls);
      }

      if (!abort.signal.aborted) {
        res.write(`data: ${JSON.stringify({ type: 'done', sessionId: sid })}\n\n`);
        res.end();
      }
    } catch (err: unknown) {
      // 错误响应体脱敏（AC-R3-2）：上游 error.message 可能含明文 api_key（日志侧已脱敏）
      const message = safeErrorMessage(err instanceof Error ? err.message : String(err));
      cleanUp();
      if (!abort.signal.aborted) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
        res.end();
      }
    }
  } else {
    try {
      let fullContent = '';
      for await (const event of agent.run(message)) {
        if (event.type === 'text') fullContent += event.content;
      }
      if (fullContent) {
        const lastAssistant = agent.getMessages().slice().reverse().find((m) => m.role === 'assistant');
        saveAssistantMessage(sid, fullContent, lastAssistant?.tool_calls);
      }
      res.json({ response: fullContent, sessionId: sid });
    } catch (err: unknown) {
      // 错误响应体脱敏（AC-R3-2）
      const message = safeErrorMessage(err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: message });
    }
  }
});

// List available tools (enabled only — disabled tools like the decommissioned
// execute_code are not exposed to the client or the LLM).
agentRouter.get('/tools', (_req, res) => {
  const tools = toolRegistry
    .getAll()
    .filter(([, def]) => def.enabled)
    .map(([name, def]) => ({
      name,
      description: def.schema.description,
      category: def.category,
      requiresApproval: def.requiresApproval,
      enabled: def.enabled,
      schema: def.schema,
    }));
  res.json({ tools });
});

// Execute a single tool
agentRouter.post('/tools/execute', async (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body required' });
  const { toolName, args, sessionId, approvalToken } = req.body;
  if (!toolName) return res.status(400).json({ error: 'toolName is required' });
  const result = await executeTool(toolName, args || {}, {
    sessionId: sessionId || 'direct',
    approvalToken,
  });
  res.json(result);
});

// Approve or deny a pending tool execution
agentRouter.post('/tools/approve', (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body required' });
  const { approvalKey, action } = req.body;
  if (!approvalKey) return res.status(400).json({ error: 'approvalKey required' });
  if (!action || (action !== 'approve' && action !== 'deny')) {
    return res.status(400).json({ error: 'action must be "approve" or "deny"' });
  }

  if (action === 'deny') {
      setApprovalWithTTL(approvalKey, '__DENIED__');
      return res.json({ ok: true, action: 'denied' });
    }
    setApprovalWithTTL(approvalKey, approvalKey);
    return res.json({ ok: true, action: 'approved' });
});

// Debug: read approval state (denied/approved/pending) for a key
agentRouter.get('/tools/approval-state', (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key is required' });
  const approvals = getToolApprovals();
  const state = approvals.get(key as string);
  if (!state) return res.json({ state: 'pending' });
  if (state === '__DENIED__') return res.json({ state: 'denied' });
  return res.json({ state: 'approved' });
});

// Toggle approval requirement（R4 安全加固）
// 鉴权由全局 auth 中间件覆盖（T01）；此处是第二道防线：关闭审批必须二次确认。
agentRouter.get('/settings/approval', (_req, res) => {
  res.json({ approvalRequired: isApprovalRequired() });
});

agentRouter.post('/settings/approval', (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body required' });
  const { enabled, confirm } = req.body;
  if (enabled === undefined || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const prev = isApprovalRequired();
  const actor = `${getRequestId() ?? 'req-unknown'}|${req.ip ?? 'unknown'}`;
  // 关闭审批（enabled=false）必须带 confirm:true，缺省拒绝且开关不变（AC-R4-2）
  if (enabled === false && confirm !== true) {
    logApprovalToggle(prev, prev, actor, 'rejected', 'missing confirm', false);
    return res.status(400).json({ error: 'confirm: true is required to disable approval' });
  }
  setApprovalRequired(enabled);
  logApprovalToggle(prev, enabled, actor, 'ok', null, confirm === true);
  res.json({ approvalRequired: isApprovalRequired() });
});

// Test OpenAI-compatible connection
agentRouter.post('/test-openai', async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body;
    const { OpenAI } = await import('openai');
    const client = new OpenAI({
      baseURL: baseUrl || 'https://api.openai.com/v1',
      apiKey: apiKey || 'dummy',
    });
    const resp = await client.chat.completions.create({
      model: model || 'gpt-4o',
      messages: [{ role: 'user', content: 'OK' }],
      max_tokens: 5,
    });
    res.json({ ok: true, message: `Connected to ${model || 'model'}`, data: resp.choices?.[0]?.message?.content });
  } catch (err: unknown) {
    logError(logger, 'test-openai', err);
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Connection failed');
    res.json({ ok: false, message });
  }
});

// Test Anthropic connection
agentRouter.post('/test-anthropic', async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body;
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey,
      baseURL: (baseUrl || 'https://api.anthropic.com').replace(/\/v1$/, ''),
    });
    const resp = await client.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'OK' }] }],
      max_tokens: 5,
    });
    res.json({ ok: true, message: `Connected to ${model || 'model'}`, data: (resp.content[0] as { type?: string; text?: string })?.text });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Connection failed');
    res.json({ ok: false, message });
  }
});

// ── Model comparison: send the same prompt to several models, return all answers ──
agentRouter.post('/compare', async (req, res) => {
  const { message, targets } = req.body || {};
  if (!message || !Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: 'message and non-empty targets[] required' });
  }
  const results = await Promise.all(
    targets.map(async (t: Record<string, unknown>) => {
      try {
        const text = await singleCompletion(t as Record<string, string>, message);
        return { provider: t.provider as string, model: t.model as string, ok: true, text };
      } catch (e: unknown) {
        // 错误响应体脱敏（AC-R3-2）：/compare 的 error 字段同样会回传客户端
        return { provider: t.provider as string, model: t.model as string, ok: false, error: safeErrorMessage(e) };
      }
    })
  );
  res.json({ results });
});

// ── Full-text search across messages (LIKE, no extra deps) ──
agentRouter.get('/search', (req, res) => {
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
agentRouter.post('/fork', (req, res) => {
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
agentRouter.get('/tokens', (req, res) => {
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
agentRouter.get('/trajectory', (req, res) => {
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
agentRouter.post('/steer', async (req, res) => {
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

// ── Context Compression API ──────────────────────────────────────────────────
agentRouter.get('/context/state', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const db = getDb();
  const msgs = db
    .prepare(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId as string) as { role: string; content: string }[];
  // Estimate tokens using the same heuristic as the compressor
  const TOKEN_CHARS = 3.8;
  const estTokens = (text: string) => {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    return Math.ceil(cjk / 1 + (text.length - cjk) / TOKEN_CHARS);
  };
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

agentRouter.post('/context/compress', async (req, res) => {
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
  const TOKEN_CHARS = 3.8;
  const estTokens = (text: string) => {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    return Math.ceil(cjk / 1 + (text.length - cjk) / TOKEN_CHARS);
  };
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

// Single (no-tools) completion against a given provider/model — used by /compare.
async function singleCompletion(t: any, message: string): Promise<string> {
  const provider = (t.provider || 'openai').toLowerCase();
  const model = t.model;
  const baseUrl = t.baseUrl;
  const apiKey = t.apiKey;
  if (provider === 'anthropic') {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, baseURL: (baseUrl || 'https://api.anthropic.com').replace(/\/v1$/, '') });
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    });
    return (resp.content[0] as { type?: string; text?: string })?.text || '';
  }
  const { OpenAI } = await import('openai');
  const client = new OpenAI({ baseURL: baseUrl || 'https://api.openai.com/v1', apiKey: apiKey || 'dummy' });
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: message }],
    max_tokens: 1024,
  });
  return resp.choices?.[0]?.message?.content || '';
}