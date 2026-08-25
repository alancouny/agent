/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// Workflow Nodes — LangGraph-style state transformers.
// Each node is a pure function (async) that receives input and
// returns NodeResult { state, edge?, events? }.
//
// Node responsibilities:
//   router      — LLM 路由决策：直接回复 / 委托子 Agent / 报错
//   supervisor  — 执行 AgentCore ReAct 循环，产出中间结果
//   delegate    — 调用 delegateTask()，将结果写回 state.subTasks
//   complete    — 汇总所有子任务结果，yield 最终答案
//   error       — 记录错误并决定是否可恢复
// ============================================================

import type { AgentMessage, AgentStreamEvent } from '../agent/types.js';
import { AgentEventBus } from '../agent/event-bus.js';
import { delegateTask, scopedReadOnlyTools } from '../agents/delegate.js';
import { blackboard } from '../shared/blackboard.js';
import type {
  WorkflowState, RoutingDecision, NodeResult, NodeInput,
} from './types.js';

// ── Router Node ─────────────────────────────────────────────
const ROUTER_ACTIONS = new Set(['direct_reply', 'reply', 'loop', 'supervisor', 'delegate', 'done', 'error']);
/** 原始调用之外的格式纠正重试次数（共 MAX+1 次尝试）。 */
const ROUTER_FORMAT_RETRIES = 2;

export async function routerNode(input: NodeInput): Promise<NodeResult> {
  const { state } = input;
  const { config, subTasks, userMessage } = state;

  const subTaskSummary = subTasks.length > 0
    ? `\n\nCompleted sub-tasks so far:\n${subTasks.map(s =>
        `- [${s.id}] ${s.ok ? 'OK' : 'FAIL'}: ${(s.output || s.error || '').slice(0, 200)}`
      ).join('\n')}`
    : '';

  const routingPrompt = `You are the Supervisor Agent. Decide the next action for this task.

User request: "${userMessage}"
${subTaskSummary}

Choose ONE action:
- direct_reply: you have enough information to answer directly
- loop: hand the task to a supervisor agent that will work through it with tools (use for anything requiring tools/files/commands)
- delegate: a sub-agent should handle a self-contained subtask
- done: all work is complete, return final result
- error: the task cannot be completed

Respond as JSON: {"action":"direct_reply|loop|delegate|done|error", "reason":"...", "taskId":"optional", "task":"<if delegate>"}
Available tools for sub-agents: ${scopedReadOnlyTools().join(', ') || 'none'}`;

  try {
    const { OpenAI } = await import('openai');
    const client = new OpenAI({
      baseURL: config.baseUrl || 'http://localhost:11434/v1',
      apiKey: config.apiKey || 'ollama',
      timeout: 60000,
      maxRetries: 0,
    });

    // ── L2 格式校验重试：模型输出无合法 JSON / action 非法时注入纠正提示重试 ──
    const messages: any[] = [
      { role: 'system', content: 'You are a routing supervisor. Always respond with valid JSON.' },
      { role: 'user', content: routingPrompt },
    ];

    let decision: RoutingDecision | null = null;
    let raw = '';
    let formatRetries = 0;

    while (decision === null && formatRetries <= ROUTER_FORMAT_RETRIES) {
      const resp = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: 256,
      });
      raw = (resp.choices?.[0]?.message?.content || '').trim();

      const parsed = parseRoutingDecision(raw);
      if (parsed.valid) {
        decision = parsed.decision;
        break;
      }

      formatRetries++;
      if (formatRetries > ROUTER_FORMAT_RETRIES) break;
      // 注入纠正提示后继续（上一次非法输出 + 纠正指令）
      messages.push({ role: 'assistant', content: raw || null });
      messages.push({
        role: 'user',
        content: `Your previous response was not valid routing JSON: ${parsed.reason}. Respond with ONLY valid JSON: {"action":"direct_reply|loop|delegate|done|error", "reason":"..."}`,
      });
    }

    if (!decision) {
      // 重试耗尽——把模型最后一次原始输出当作直接回答，保证流程不卡死
      decision = { kind: 'reply', text: raw.slice(0, 1000) || 'Task cannot be classified; answering directly.' };
    }

    state.decision = decision;

    trackEvent(state, {
      type: 'thinking',
      content: `[ROUTER] ${decision.kind}${decision.kind === 'delegate' ? ` → task=${decision.taskId}` : ''}${formatRetries > 0 ? ` (${formatRetries} format retries)` : ''}`,
      turnIdx: 0, stepIdx: state.llmCalls + 1,
    });

    blackboard.set(`routing:${state.sessionId}`, decision, state.sessionId);
    return { state, edge: decisionEdge(decision) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(`routerNode failed: ${msg}`);
    return { state, edge: 'error' };
  }
}

export type ParsedDecision = { valid: true; decision: RoutingDecision } | { valid: false; reason: string };

export function parseRoutingDecision(raw: string): ParsedDecision {
  if (!raw) return { valid: false, reason: 'empty response' };
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // 模型直接给纯文本回答（未包 JSON）→ 视为 direct_reply，合法
    return { valid: true, decision: { kind: 'reply', text: raw.slice(0, 1000) } };
  }
  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const action = String(obj.action || '').toLowerCase();
    if (!action || !ROUTER_ACTIONS.has(action)) {
      return { valid: false, reason: `unknown action '${action || '(missing)'}'` };
    }
    if (action === 'delegate') {
      return {
        valid: true,
        decision: {
          kind: 'delegate',
          taskId: String(obj.taskId || `task-${Date.now()}`),
          task: String(obj.task || raw.slice(0, 500)),
          agentType: String(obj.agentType || ''),
        },
      };
    }
    if (action === 'loop' || action === 'supervisor') {
      return { valid: true, decision: { kind: 'loop', reason: String(obj.reason || '') } };
    }
    if (action === 'done') return { valid: true, decision: { kind: 'done', reason: String(obj.reason || '') } };
    if (action === 'error') {
      return { valid: true, decision: { kind: 'error', message: String(obj.reason || obj.message || raw), recoverable: true } };
    }
    // direct_reply / reply
    return { valid: true, decision: { kind: 'reply', text: String(obj.text || obj.reason || raw).slice(0, 1000) } };
  } catch {
    return { valid: false, reason: 'malformed JSON' };
  }
}

function decisionEdge(d: RoutingDecision): 'delegate' | 'loop' | 'complete' | 'error' | undefined {
  if (d.kind === 'delegate') return 'delegate';
  if (d.kind === 'loop') return 'loop';
  if (d.kind === 'done' || d.kind === 'reply') return 'complete';
  if (d.kind === 'error') return 'error';
  return undefined;
}

// ── Supervisor Node ─────────────────────────────────────────
export async function supervisorNode(input: NodeInput): Promise<NodeResult> {
  const { state } = input;
  const { config, sessionId } = state;

  // 动态 import 避免循环依赖
  const { AgentCore } = await import('../agent/core.js');
  // 瀑布图层级标记：workflow 内的 agent 节点记作 supervisor
  const agent = new AgentCore(
    { ...config, telemetry: { ...(config.telemetry ?? {}), agentKind: 'supervisor' as const } },
    sessionId,
    [...state.messages]
  );

  try {
    // 流式转发：agent 每产出一个过程事件（thinking/tool_call/tool_result/approval/error），
    // 立即 emit 给 graph 运行时 → 调用方（前端打字机效果）。
    // text 事件不转发——最终答案由 complete 节点合并后统一输出，避免重复渲染。
    const bus = new AgentEventBus();
    bus.on('event', (ev) => {
      if (ev.type === 'text') return;
      input.emit?.(ev);
    });
    await agent.run(state.userMessage, { eventBus: bus });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    input.emit?.({ type: 'error', error: msg, turnIdx: 0, stepIdx: state.llmCalls + 1 });
  }

  // 累计计数（从 public accessors 读取）
  // 只统计本次 agent.run 新增的调用，避免循环叠加历史计数
  const prevToolCalls = countToolCalls([...state.messages]);
  state.llmCalls += agent.currentStepIdx;
  state.toolCalls += countToolCalls(agent.currentMessages) - prevToolCalls;
  state.messages = agent.currentMessages;

  const lastAssistant = [...agent.currentMessages].reverse().find(m => m.role === 'assistant');
  const hasPendingToolCalls = (lastAssistant?.tool_calls?.length ?? 0) > 0;

  if (hasPendingToolCalls) {
    state.errors.push('Supervisor loop interrupted — re-routing');
    return { state, edge: 'loop' };
  }

  const finalText = lastAssistant?.content?.trim();
  if (finalText && finalText.length > 10) {
    return { state, edge: 'done' };
  }
  return { state, edge: 'loop' };
}

function countToolCalls(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.tool_calls?.length ?? 0), 0);
}

// ── Delegate Node ───────────────────────────────────────────
export async function delegateNode(input: NodeInput): Promise<NodeResult> {
  const { state, taskId = `task-${Date.now()}`, task = '', agentType = '' } = input;
  const { config } = state;

  const result = await delegateTask({
    task,
    config: {
      provider: config.provider || 'openai',
      model: config.model || 'gpt-4o',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      maxIterations: 1,
      maxTokens: config.maxTokens || 2048,
      temperature: 0.4,
      systemPrompt: agentType ? `You are an ${agentType}.` : '',
    },
    allowedTools: scopedReadOnlyTools(),
    errorBudget: 3,
  });

  const subTask = {
    id: taskId || `task-${Date.now()}`,
    agentType,
    ok: result.ok,
    output: result.output,
    error: result.error,
    delegateResult: result,
    completedAt: new Date().toISOString(),
  };

  state.subTasks.push(subTask);
  state.delegateCalls++;
  state.llmCalls += result.errorCount + 1;

  blackboard.set(`subtask:${taskId}`, subTask, state.sessionId);

  trackEvent(state, {
    type: 'thinking',
    content: `[DELEGATE ${taskId}] ${result.ok ? 'OK' : 'FAIL'} (${result.toolCalls} tool calls, ${result.errorCount} retries)`,
    turnIdx: 0, stepIdx: state.delegateCalls,
  });

  return { state, edge: 'complete' };
}

// ── Complete Node ───────────────────────────────────────────
export async function completeNode(input: NodeInput): Promise<NodeResult> {
  const { state, messages } = input;

  const allSubTasks = state.subTasks;

  const parts: string[] = [];

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  if (lastAssistant?.content?.trim()) {
    parts.push(lastAssistant.content.trim());
  }

  if (allSubTasks.length > 0) {
    parts.push('\n--- Sub-task Results ---');
    for (const st of allSubTasks) {
      const status = st.ok ? '✓' : '✗';
      parts.push(`[${status}] ${st.id}${st.agentType ? ` (${st.agentType})` : ''}:`);
      parts.push(st.ok ? `  ${st.output.slice(0, 500)}` : `  Error: ${st.error || 'unknown'}`);
    }
  }

  const finalAnswer = parts.join('\n').trim() || 'Task completed.';
  state.done = true;

  trackEvent(state, { type: 'text', content: finalAnswer, turnIdx: 0, stepIdx: state.llmCalls });

  return { state };
}

// ── Error Node ──────────────────────────────────────────────
export async function errorNode(input: NodeInput): Promise<NodeResult> {
  const { state, error = 'unknown', recoverable } = input;

  state.errors.push(error);
  blackboard.set(`error:${state.sessionId}:${Date.now()}`, { error, recoverable }, state.sessionId);

  trackEvent(state, { type: 'error', error, turnIdx: 0, stepIdx: state.llmCalls });

  if (recoverable !== false) {
    return { state, edge: 'loop' };
  }
  state.done = true;
  return { state };
}

// ── 辅助：将事件挂到 state.pendingEvents，由 graph 运行时统一 yield ──
function trackEvent(state: WorkflowState, ev: AgentStreamEvent): void {
  if (!state.pendingEvents) state.pendingEvents = [];
  state.pendingEvents.push(ev);
}
