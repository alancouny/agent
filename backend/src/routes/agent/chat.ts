/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { AgentCore } from '../../agent/core.js';
import { AgentEventBus } from '../../agent/event-bus.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig, AgentStreamEvent } from '../../agent/types.js';
import { getModelContextWindow } from '../model_provider.js';
import { ingestDrift } from '../../telemetry/drift.js';
import { loadMessages, saveUserMessage, saveAssistantMessage, ensureSession } from '../../session/messages.js';
import { safeErrorMessage } from '../../utils/error-mask.js';
import '../../tools/builtin.js';
import '../../computer-use/register-tools.js';
import '../../tasks/agent-tools.js';
import '../../tools/system-tools.js';
import '../../tools/agent-meta-tools.js';

export const chatRouter = Router();

const AUTO_RUN_INSTRUCTIONS = `
AUTO-RUN MODE ENABLED. For every user request, automatically manage task tracking using these tools:
1. First call create_task with a concise title describing the user's goal.
2. Then call add_task_step for each distinct step you plan to execute.
3. As you work, call update_task_step to mark steps running/completed with brief output.
4. When finished, call complete_task with status 'completed' (or 'failed' if something went wrong).

Do NOT ask the user for permission to create tasks — always do it automatically. Keep task titles short and steps concrete. Only create a task if the request is non-trivial (more than a simple one-liner answer); for trivial requests, answer directly without task tracking.`;

chatRouter.post('/', async (req: Request, res: Response) => {
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

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 客户端断连即中止 agent（LLM 调用间隙 / 循环头部检查 signal），避免后台继续烧 token 与执行工具
    const abort = new AbortController();
    const clientGone = () => abort.abort();
    res.on('close', clientGone);

    // ── D2：事件总线解耦 ── AgentCore 通过 bus 广播事件，SSE 仅负责传输
    const bus = new AgentEventBus();
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

    bus.on('event', (event: AgentStreamEvent) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'text') fullContent += event.content;
    });

    try {
      await streamAgent.run(message, { eventBus: bus });

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
      const bus = new AgentEventBus();
      const agent = new AgentCore(config, sid, history);

      let fullContent = '';
      bus.on('event', (event: AgentStreamEvent) => {
        if (event.type === 'text') fullContent += event.content;
      });

      await agent.run(message, { eventBus: bus });
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
