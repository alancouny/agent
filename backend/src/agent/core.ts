/* eslint-disable @typescript-eslint/no-explicit-any */
import { toolRegistry, executeTool, getToolApprovals } from '../tools/registry.js';
import { llmTracer } from '../telemetry/llm-trace.js';
import { parseCostEstimate, saveCostEstimate } from '../telemetry/metacog.js';
import { recordLesson } from '../memory/lessons.js';
import '../tools/builtin.js';
import { getDb } from '../db/database.js';
import { skillStore } from '../skills/store.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig, AgentMessage, ToolCall, AgentStreamEvent } from './types.js';
import { executeHooks } from './hooks.js';
import { maybeCompress, estimateMessagesTokens } from './context-compressor.js';
import type {
  BeforeRunContext, BeforeModelCallContext, BeforeToolCallContext,
  AfterModelCallContext, AfterToolCallContext, AfterRunContext,
} from './hooks.js';
import { search as kbSearch, getConfig } from '../knowledge/store.js';
import { sessionEvents } from '../session/events.js';
import { AgentEventBus } from './event-bus.js';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools.
When you need to use a tool, call it with the correct parameters. Use the result to answer the user. You can use multiple tools in sequence. Explain what you're doing.

When a request involves several distinct steps, track it with the task tools:
- create_task to plan the work,
- add_task_step for each step,
- update_task_step as you start and finish each step (status: running / completed / failed),
- complete_task when everything is done.
This lets the user follow your progress in the Tasks panel. Keep tasks lightweight and only create them when the work is genuinely multi-step.`;

const TOOL_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_FAILURES = 3; // 死循环熔断：同一工具连续失败次数阈值
const LLM_BACKOFF_BASE_MS = 1_000; // 指数退避基准
const LLM_BACKOFF_MAX_MS = 30_000; // 指数退避上限
const LLM_MAX_RETRIES = 3; // 基础设施级重试上限

/** 非瞬时 LLM 错误（401/400/404 等）：确定性问题，重试与退避无意义。 */
class NonRetriableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetriableError';
  }
}

export class AgentCore {
  private config: AgentConfig;
  private sessionId: string;
  private messages: AgentMessage[];
  private hooks: AgentConfig['hooks'];
  private turnIdx = 0;
  private stepIdx = 0;
  /** 死循环检测：toolName → 连续失败次数。达到 MAX_CONSECUTIVE_FAILURES 后熔断。 */
  private consecutiveFailures: Map<string, number> = new Map();
  /** 当前迭代的 LLM 调用 id（瀑布图：工具执行时挂到 ToolContext.llmCallId）。 */
  private currentLlmCallId: string | null = null;
  /** 元认知：本次 run 的预算预测（第一次响应解析）。 */
  private metaEstimate: { predictedToolCalls?: number; predictedTokens?: number } | null = null;
  /** 教训收集（经验回放）：run 期间的失败摘要。 */
  private lessonNotes: string[] = [];
  /** 元认知统计：本次 run 的实际工具调用数 / 总 token。 */
  private actualToolCallsCount = 0;
  private runTotalTokens = 0;

  constructor(config: AgentConfig, sessionId: string, messages?: AgentMessage[]) {
    this.config = { ...config, systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT };
    this.sessionId = sessionId;
    // 深拷贝历史：外部（steer / hooks / 并行 run）对同一数组的修改不串扰本实例
    this.messages = messages && messages.length
      ? messages.map((m) => ({ ...m, tool_calls: m.tool_calls ? m.tool_calls.map((tc) => ({ ...tc, function: { ...tc.function } })) : m.tool_calls }))
      : [{ role: 'system', content: this.config.systemPrompt }];
    this.hooks = config.hooks;
  }

  // ── Public accessors（供 Workflow nodes 读取运行时状态）─────────
  get currentTurnIdx(): number      { return this.turnIdx; }
  get currentStepIdx(): number      { return this.stepIdx; }
  get currentMessages(): AgentMessage[] { return this.messages; }

  /** 重置每轮迭代的连续失败计数（每个新 turn 清零）。 */
  private resetFailureCounters(): void {
    this.consecutiveFailures.clear();
  }

  /**
   * 从工具调用中提取文件修改信息，供前端 file_modified SSE 事件使用。
   * 支持 write_file（直接路径）和 run_code（检测代码中的 fs.writeFileSync 调用）。
   */
  private extractFileModified(
    toolName: string,
    argsJson: string,
    output: string
  ): { path: string; operation: 'write' | 'create'; lineCount?: number; snippet?: string } | null {
    let filePath: string | undefined;
    const op: 'write' | 'create' = 'write';

    if (toolName === 'write_file') {
      try {
        const args = JSON.parse(argsJson);
        filePath = args.path;
      } catch { /* ignore */ }
    } else if (toolName === 'run_code') {
      // 尝试从 run_code 的 output 中提取 fs.writeFileSync 目标路径
      const match = output.match(/File written:\s*(.+?)\s*\(/);
      if (match) filePath = match[1].trim();
      if (!filePath) {
        // 也尝试从 args 中提取
        try {
          const args = JSON.parse(argsJson);
          if (args.code?.includes('fs.writeFileSync') || args.code?.includes('writeFileSync')) {
            const codeMatch = args.code?.match(/writeFileSync\s*\(\s*['"](.+?)['"]/);
            if (codeMatch) filePath = codeMatch[1];
          }
        } catch { /* ignore */ }
      }
    }

    if (!filePath) return null;

    // 计算行数 & 截取内容片段
    const contentMatch = output.match(/\((\d+)\s*bytes\)/);
    const byteCount = contentMatch ? parseInt(contentMatch[1], 10) : 0;
    const lineCount = Math.max(1, Math.ceil(byteCount / 60)); // 估算
    const snippet = output.replace(/[^\n\r]/g, '').length > 0
      // eslint-disable-next-line no-control-regex
      ? output.slice(0, 200).replace(/[^\u0000-\u007F]/g, '')
      : '';

    return { path: filePath, operation: op, lineCount, snippet };
  }

  /** Session Log: append a durable event (source of truth for the trajectory). */
  private logEvent(
    type: Parameters<typeof sessionEvents.append>[0]['type'],
    extra: Partial<Parameters<typeof sessionEvents.append>[0]> = {}
  ): void {
    try {
      // Fire-and-forget: logEvent must never block the agent loop.
      // sessionEvents.append is now async under concurrent load; errors are swallowed.
      sessionEvents.append({
        sessionId: this.sessionId,
        turnIdx: this.turnIdx,
        stepIdx: this.stepIdx,
        type,
        ...extra,
      }).catch(() => { /* best-effort, never break the agent */ });
    } catch {
      /* event log must never break the agent loop */
    }
  }

  private loadMemories(): string {
    try {
      const db = getDb();
      const rows = db
        .prepare(`SELECT content, summary FROM memories WHERE session_id = ? ORDER BY importance DESC, accessed_at DESC LIMIT 10`)
        .all(this.sessionId) as { content: string; summary: string }[];
      if (!rows.length) return '';
      const lines = rows.map((r, i) => `${i + 1}. ${r.summary || r.content}`);
      return `\n\nRelevant memories from earlier in this session:\n${lines.join('\n')}`;
    } catch {
      return '';
    }
  }

  /** 全局长期记忆注入（跨会话，多来源合并检索；仅读，防循环）。 */
  private async loadGlobalMemories(userMessage: string): Promise<string> {
    const mem = this.config.memory;
    if (!mem?.enabled) return '';
    try {
      const { searchAllMemories } = await import('../memory/registry.js');
      const hits = await searchAllMemories(userMessage, mem.topK ?? 4);
      if (!hits.length) return '';
      const lines = hits.map((m) => `- [${m.providerId}] ${m.content}${m.tags?.length ? ` (${m.tags.join(',')})` : ''}`);
      return `\n\n[LONG-TERM MEMORY — retrieved for this request]\n${lines.join('\n')}`;
    } catch {
      return ''; // 记忆注入失败不影响主流程
    }
  }

  private loadSkills(): string {
    try {
      const skills = skillStore.list();
      if (!skills.length) return '';

      // P4: only inject skills whose "when" or name matches likely user intent keywords.
      const lastUserMessage = this.messages
        .filter(m => m.role === 'user')
        .at(-1)?.content || '';
      const lower = lastUserMessage.toLowerCase();

      const matched = skills.filter(s => {
        const when = s.when.toLowerCase();
        const name = s.name.toLowerCase();
        const keywords = new Set(
          [...when.matchAll(/[a-zA-Z]{5,}/g)]
            .map(m => m[0].toLowerCase())
        );
        for (const part of name.split(/[\s\-/]+/)) if (part.length > 3) keywords.add(part.toLowerCase());

        for (const kw of keywords) {
          if (lower.includes(kw)) return true;
        }
        return false;
      });

      if (!matched.length) return '';

      const blocks = matched.map(s => {
        const steps = s.steps.map((st, i) => `${i + 1}. ${st}`).join('\n');
        return `### ${s.name}\nWhen: ${s.when}\nSteps:\n${steps}`;
      });
      return `\n\nRelevant skills for this request (follow the steps):\n${blocks.join('\n\n')}`;
    } catch {
      return '';
    }
  }

  /** Retrieve relevant knowledge-base chunks and format them for the system prompt. */
  private async retrieveKnowledge(userMessage: string): Promise<string> {
    try {
      const cfg = getConfig();
      const results = await kbSearch(userMessage, { topK: cfg.topK, threshold: cfg.scoreThreshold });
      if (!results.length) return '';
      const blocks = results
        .filter((r) => r.score >= cfg.scoreThreshold)
        .map((r, i) => `[${i + 1}] (from ${r.docTitle}, score ${r.score.toFixed(2)})\n${r.content}`);
      if (!blocks.length) return '';
      return `\n\nRelevant knowledge from your knowledge base (use it to answer if relevant):\n${blocks.join('\n\n')}`;
    } catch {
      return ''; // embedding service unavailable — degrade gracefully
    }
  }

  private logUsage(usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void {
    try {
      // 兼容 OpenAI(snake_case) / Anthropic / 自定义网关的 usage 结构
      const u = usage as any;
      const prompt = u.promptTokens ?? u.prompt_tokens ?? 0;
      const completion = u.completionTokens ?? u.completion_tokens ?? 0;
      const total = u.totalTokens ?? u.total_tokens ?? prompt + completion;
      if (!total) return;
      const db = getDb();
      db.prepare(
        `INSERT INTO usage_log (id, session_id, prompt_tokens, completion_tokens, total_tokens, model) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        uuidv4(),
        this.sessionId,
        prompt,
        completion,
        total,
        this.config.model
      );
    } catch { /* best-effort usage tracking */ }
  }

  private saveMemory(userMessage: string, finalAnswer: string): void {
    try {
      const db = getDb();
      const id = uuidv4();
      const content = `User asked: ${userMessage}\nAgent answered: ${finalAnswer.slice(0, 500)}`;
      const summary = finalAnswer.split('\n')[0].slice(0, 200) || finalAnswer.slice(0, 200);
      db.prepare(
        `INSERT INTO memories (id, session_id, type, content, summary, importance) VALUES (?, ?, 'semantic', ?, ?, 0.5)`
      ).run(id, this.sessionId, content, summary);
    } catch { /* best-effort memory persist */ }
  }

  /** Steering: pull any user message queued while the agent was running and inject it before the next step. */
  private drainSteering(): string[] {
    try {
      const db = getDb();
      const rows = db
        .prepare(`SELECT id, content FROM session_events WHERE session_id = ? AND type = 'steer' AND result IS NULL ORDER BY seq ASC`)
        .all(this.sessionId) as { id: string; content: string | null }[];
      if (!rows.length) return [];
      const mark = db.prepare(`UPDATE session_events SET result = ? WHERE id = ?`);
      for (const r of rows) {
        mark.run('injected', r.id);
        if (r.content) this.messages.push({ role: 'user', content: r.content });
      }
      return rows.map((r) => r.content || '').filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Run one tool with an execution timeout. */
  private async runToolWithTimeout(
    name: string,
    args: Record<string, unknown>,
    context: { sessionId: string; approvalToken?: string; agentConfig?: AgentConfig; llmCallId?: string }
  ): Promise<Awaited<ReturnType<typeof executeTool>>> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([executeTool(name, args, context), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 运行一轮 agent loop。事件通过 eventBus 广播（解耦传输层），不再 yield 生成器。
   * 调用方（SSE 路由）创建 AgentEventBus 并订阅 'event' channel 即可消费全部事件。
   */
  async run(userMessage: string, opts?: { eventBus?: AgentEventBus }): Promise<void> {
    const bus = opts?.eventBus ?? new AgentEventBus();
    const emit = (event: AgentStreamEvent) => bus.emitEvent(event);
    this.turnIdx += 1;
    this.stepIdx = 0;
    this.messages.push({ role: 'user', content: userMessage });
    this.logEvent('turn_start');
    this.logEvent('user_message', { role: 'user', content: userMessage });

    let turnError: string | undefined;

    try {
    // Assemble the system prompt (memories + skills + knowledge injection) — Harness: context is an explicit, logged event.
    const kb = await this.retrieveKnowledge(userMessage);
    const globalMem = await this.loadGlobalMemories(userMessage);
    const metaDirective = this.config.metacognition?.enabled && this.turnIdx === 1
      ? `\n\n[METACOGNITION] Before answering, estimate this task's compute budget. Output a line starting with COST_ESTIMATE: {"predictedToolCalls": <int>, "predictedTokens": <int>} then proceed normally.`
      : '';
    const systemPrompt = this.config.systemPrompt + this.loadMemories() + globalMem + this.loadSkills() + kb + metaDirective;
    this.messages[0].content = systemPrompt;
    this.logEvent('context_injected', {
      role: 'system',
      content: `memories=${systemPrompt.includes('Relevant memories')} skills=${systemPrompt.includes('Relevant skills')} kb=${kb.length > 0}`,
    });
    this.saveSession();

    // ── Hook: beforeRun ──
    const beforeRunRes = await executeHooks<BeforeRunContext>(this.hooks?.beforeRun, {
      userMessage,
      sessionId: this.sessionId,
      config: this.config,
      messages: this.messages,
    });
    if (beforeRunRes.aborted) {
      this.logEvent('error', { content: `Hook aborted before run: ${beforeRunRes.message}` });
      emit({ type: 'error', error: `Hook aborted before run: ${beforeRunRes.message}`, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
      return;
    }

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // 外部中止（SSE 断连等）：尽早退出，避免继续烧 token / 执行工具
      if (this.config.signal?.aborted) {
        this.logEvent('error', { content: 'Agent aborted by client disconnect' });
        return;
      }
      this.stepIdx = iteration + 1;
      emit({ type: 'thinking', content: `Iteration ${iteration + 1}/${this.config.maxIterations}`, turnIdx: this.turnIdx, stepIdx: this.stepIdx });

      // 每个 turn 开始时重置连续失败计数（跨 turn 重新评估）
      this.resetFailureCounters();

      // Steering: user messages sent mid-run are injected before the next model call.
      const steered = this.drainSteering();
      for (const s of steered) {
        emit({ type: 'thinking', content: `Steering: "${s.slice(0, 120)}" injected before next step`, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        this.logEvent('steer', { role: 'user', content: s });
      }

      // ── Adaptive context compression (three-layer strategy) ──
      const currentTokens = estimateMessagesTokens(this.messages);
      const compressResult = await maybeCompress(this, this.config.contextWindow, currentTokens);
      if (compressResult.compressed) {
        this.logEvent('context_compressed', { content: JSON.stringify(compressResult) });
        emit({
          type: 'context_compressed',
          turnIdx: this.turnIdx,
          stepIdx: this.stepIdx,
          contextCompressed: {
            beforeTokens: currentTokens,
            afterTokens: currentTokens - compressResult.compressedTokenSavings,
            savings: compressResult.compressedTokenSavings,
            layers: compressResult.layerBreakdown as any,
            usageRatio: currentTokens / (this.config.contextWindow || 128000),
          },
        });
      }

      // ── Hook: beforeModelCall ──
      const toolSchemas = toolRegistry.getSchemas();
      const apiMessages: unknown[] = this.messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
        name: m.name,
      }));
      const beforeModelRes = await executeHooks<BeforeModelCallContext>(this.hooks?.beforeModelCall, {
        apiMessages,
        config: this.config,
        iteration,
        toolSchemas,
      });
      if (beforeModelRes.aborted) {
        this.logEvent('error', { content: `Hook aborted before model call: ${beforeModelRes.message}` });
        emit({ type: 'error', error: `Hook aborted before model call: ${beforeModelRes.message}`, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        return;
      }

      // ── LLM 调用打点（瀑布图）：begin 后调用，finally 语义由响应路径 end 补全 ──
      const tel = this.config.telemetry;
      this.currentLlmCallId = llmTracer.begin({
        sessionId: this.sessionId,
        agentKind: tel?.agentKind ?? 'main',
        parentId: tel?.parentCallId ?? null,
        model: this.config.model,
        turn: this.turnIdx,
        step: this.stepIdx,
      });

      const response = await this.callLLM();
      if (!response) {
        if (this.currentLlmCallId) {
          llmTracer.end(this.currentLlmCallId, { failed: true, contentPreview: 'callLLM returned null' });
          this.currentLlmCallId = null;
        }
        this.logEvent('error', { content: 'Failed to get response from LLM' });
        emit({ type: 'error', error: 'Failed to get response from LLM (callLLM returned null)', turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        return;
      }

      const { content, toolCalls } = this.normalizeResponse(response);
      // 元认知：从首次响应提取预算预测
      if (this.config.metacognition?.enabled && this.metaEstimate === null) {
        const est = parseCostEstimate(content || '');
        if (est) this.metaEstimate = est;
      }
      if (this.currentLlmCallId) {
        // 瀑布图补全：token 用量 + 触发的工具 + 内容预览
        const usage = (response as any)?.usage;
        llmTracer.end(this.currentLlmCallId, {
          promptTokens: usage?.prompt_tokens ?? usage?.promptTokens ?? 0,
          completionTokens: usage?.completion_tokens ?? usage?.completionTokens ?? 0,
          toolNames: toolCalls.map((tc) => tc.function.name),
          contentPreview: content || '',
        });
        this.currentLlmCallId = null;
      }
      if (!content && !toolCalls.length) {
        this.logEvent('error', { content: 'Empty LLM response' });
        emit({ type: 'error', error: 'Empty LLM response', turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        return;
      }

      // ── Hook: afterModelCall（路由判断：继续工具链 / 终止 turn）──
      const afterModelRes = await executeHooks<AfterModelCallContext>(this.hooks?.afterModelCall, {
        rawResponse: response,
        content,
        toolCalls,
        iteration,
        config: this.config,
      });
      if (afterModelRes.aborted) {
        this.logEvent('error', { content: `Hook aborted after model call: ${afterModelRes.message}` });
        emit({ type: 'error', error: `Hook aborted after model call: ${afterModelRes.message}`, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        return;
      }
      // Hook 可修改 toolCalls（比如过滤掉不允许的工具调用）
      const routedToolCalls = afterModelRes.ctx.toolCalls.length > 0
        ? afterModelRes.ctx.toolCalls
        : toolCalls;

      const usage = (response as any)?.usage;
      if (usage) this.logUsage(usage);
      // 归一化为 camelCase 并附加模型上下文窗口容量，前端据此实时渲染利用率进度条
      const normalizedUsage = usage
        ? {
            promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? 0,
            completionTokens: usage.completion_tokens ?? usage.completionTokens ?? 0,
            totalTokens: usage.total_tokens ?? usage.totalTokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
            ...(this.config.contextWindow ? { contextWindow: this.config.contextWindow } : {}),
          }
        : undefined;
      this.logEvent('model_call', {
        model: this.config.model,
        tokens: normalizedUsage,
      });
      if (content) {
        this.logEvent('text', { role: 'assistant', content });
        if (normalizedUsage?.totalTokens) this.runTotalTokens += normalizedUsage.totalTokens;
        emit({ type: 'text', content, usage: normalizedUsage, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
      }

      if (routedToolCalls.length === 0) {
        this.messages.push({ role: 'assistant', content });
        this.saveMemory(userMessage, content);
        this.logEvent('complete');
        emit({ type: 'complete', turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        this.saveSession();
        return;
      }

      this.messages.push({ role: 'assistant', content: content || '', tool_calls: routedToolCalls });

      // ── Tool pipeline: schedule calls. Read-only (no approval) calls run in parallel;
      //    anything that could mutate state or needs approval is a barrier and runs alone. ──
      const results: { tc: ToolCall; output: string; error?: string }[] = [];

      const toolDefs = toolCalls.map((tc) => ({ tc, def: toolRegistry.get(tc.function.name) }));
      const batches: { tc: ToolCall; def?: ReturnType<typeof toolRegistry.get> }[][] = [];
      let current: { tc: ToolCall; def?: ReturnType<typeof toolRegistry.get> }[] = [];

      for (const item of toolDefs) {
        const canParallel = !!item.def?.readOnly && !item.def?.requiresApproval;
        if (canParallel && current.every((c) => !!c.def?.readOnly && !c.def?.requiresApproval)) {
          current.push(item);
        } else {
          if (current.length) {
            batches.push(current);
            current = [];
          }
          current.push(item);
        }
      }
      if (current.length) batches.push(current);

      for (const batch of batches) {
        // Read-only batches run in parallel. Approval-gated tools are barriers,
        // so the batch never contains more than one of them.
        const started = batch.map(async ({ tc }) => {
          const { approval, output, error } = await this.executeOneTool(tc, iteration);
          return { tc, approval, output, error };
        });
        const completed = await Promise.all(started);
        for (const item of completed) {
          if (item.approval) {
            emit({ type: 'approval_pending', approval: item.approval, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
          }
          results.push({ tc: item.tc, output: item.output, error: item.error });
        }
      }

      // Append tool results to the message history in the original call order (API requirement).
      const hallucinatedTools: string[] = [];
      for (const r of results) {
        this.messages.push({
          role: 'tool',
          content: r.output,
          tool_call_id: r.tc.id,
          name: r.tc.function.name,
        });
        this.actualToolCallsCount += 1;
        emit({ type: 'tool_result', toolResult: { name: r.tc.function.name, result: r.output }, turnIdx: this.turnIdx, stepIdx: this.stepIdx });

        // 发射 file_modified 事件（write_file / run_code 写文件时）
        const fm = this.extractFileModified(r.tc.function.name, r.tc.function.arguments, r.output);
        if (fm) {
          emit({ type: 'file_modified', fileModified: fm, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
        }

        // 死循环检测：累计同一工具的连续失败次数
        if (r.error) {
          const count = (this.consecutiveFailures.get(r.tc.function.name) || 0) + 1;
          this.consecutiveFailures.set(r.tc.function.name, count);
          if (count >= MAX_CONSECUTIVE_FAILURES) {
            const msg = `DEAD_LOOP_DETECTED: tool '${r.tc.function.name}' failed ${count} times consecutively. Aborting turn.`;
            this.logEvent('error', { content: msg });
            throw new Error(msg);
          }
        } else {
          // 工具成功则清零其失败计数
          this.consecutiveFailures.delete(r.tc.function.name);
        }

        if (r.error === 'TOOL_NOT_FOUND') hallucinatedTools.push(r.tc.function.name);
      }

      // Level 2: 幻觉工具名反思注入
      // 将不存在的工具名信息作为系统消息回灌，让 LLM 在当前上下文中自我纠错，
      // 避免下一轮继续调用同一错误工具。
      if (hallucinatedTools.length > 0) {
        const hint = `The following tools you attempted to call do not exist: ${hallucinatedTools.join(', ')}. `
          + `Available tools are: ${toolRegistry.getSchemas().map(s => `'${s.name}'`).join(', ') || 'none'}. `
          + `Please retry with correct tool names and valid arguments.`;
        this.logEvent('reflection', { role: 'system', content: hint });
        this.messages.push({ role: 'system', content: hint });
      }

      this.saveSession();
    }

    this.lessonNotes.push('max iterations reached (agent looped without converging)');
    this.logEvent('error', { content: 'Max iterations reached' });
    emit({ type: 'error', error: 'Max iterations reached', turnIdx: this.turnIdx, stepIdx: this.stepIdx });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      turnError = message;
      this.logEvent('error', { content: turnError });
      emit({ type: 'error', error: turnError, turnIdx: this.turnIdx, stepIdx: this.stepIdx });
    } finally {
      // ── Hook: afterRun（turn 结束，所有出口都会触发）──
      const actualIter = this.stepIdx;
      const assistantMsg = [...this.messages].reverse().find(m => m.role === 'assistant');
      const finalContent = assistantMsg?.content;
      const afterRunRes = await executeHooks<AfterRunContext>(this.hooks?.afterRun, {
        sessionId: this.sessionId,
        messages: this.messages,
        finalContent,
        error: turnError,
        maxIterations: this.config.maxIterations,
        actualIterations: actualIter,
        config: this.config,
      });
      // afterRun 是收尾阶段，即使返回 abort 也不终止已开始的流（仅打日志）
      if (afterRunRes.aborted) {
        logger.warn(`[HOOK] afterRun aborted: ${afterRunRes.message}`);
      }

      // ── 元认知：保存预算预测 vs 实测（校准数据）──
      if (this.config.metacognition?.enabled) {
        try {
          saveCostEstimate({
            sessionId: this.sessionId,
            model: this.config.model,
            predictedToolCalls: this.metaEstimate?.predictedToolCalls ?? null,
            predictedTokens: this.metaEstimate?.predictedTokens ?? null,
            actualToolCalls: this.actualToolCallsCount,
            actualTokens: this.runTotalTokens,
          });
        } catch { /* best-effort */ }
      }

      // ── 经验回放：失败蒸馏为长期记忆中的教训 ──
      if (this.lessonNotes.length) {
        void recordLesson(this.sessionId, this.lessonNotes);
      }
    }
  }

  /**
   * Single tool execution pipeline: hooks → approval gate → run (retry-once).
   * Returns { approval?, output, error }; when approval is required the pending
   * event is returned for the caller to stream, and this call itself blocks
   * until the user approves/denies/times out (approval tools are barriers).
   */
  private async executeOneTool(
    tc: ToolCall,
    iteration: number
  ): Promise<{ approval?: AgentStreamEvent['approval']; output: string; error?: string }> {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

    this.logEvent('tool_call', { toolName: tc.function.name, args });

    // ── Hook: beforeToolCall (may modify args) ──
    const toolSchema = toolRegistry.get(tc.function.name)?.schema;
    const beforeToolRes = await executeHooks<BeforeToolCallContext>(this.hooks?.beforeToolCall, {
      toolName: tc.function.name,
      args,
      toolSchema,
      sessionId: this.sessionId,
      iteration,
    });
    if (beforeToolRes.aborted) {
      const msg = `Hook aborted before tool call ${tc.function.name}: ${beforeToolRes.message}`;
      this.logEvent('error', { content: msg });
      return { output: msg, error: 'HOOK_ABORTED' };
    }
    args = beforeToolRes.ctx.args;

    // ── Execute with timeout + retry-once for transient failures ──
    const runOnce = async () => {
      return this.runToolWithTimeout(tc.function.name, args, {
        sessionId: this.sessionId,
        agentConfig: this.config,
        llmCallId: this.currentLlmCallId ?? undefined,
      } as any);
    };

    let result = await runOnce();

    if (result.error === 'PENDING_APPROVAL') {
      const approvalKey = (result.data as any)?.approvalKey;
      const approval: AgentStreamEvent['approval'] = {
        toolName: tc.function.name,
        args,
        approvalKey,
        output: result.output,
      };
      this.logEvent('approval_pending', { toolName: tc.function.name, args });

      // Wait for user approval / denial / timeout (120s)
      const approvedResult = await this.waitForApproval(
        tc.function.name,
        args,
        approvalKey,
        120_000
      );
      this.logEvent('approval_resolved', {
        toolName: tc.function.name,
        result: { error: approvedResult.error || null, success: approvedResult.success },
      });
      result = approvedResult;
      this.logEvent('tool_result', { toolName: tc.function.name, result: { success: result.success, error: result.error || null } });
      return { approval, output: result.output, error: result.error };
    }

    if (!result.success && /timeout|ECONNRESET|ETIMEDOUT|rate limit|429/i.test(result.error || '')) {
      // transient — retry once
      result = await runOnce();
    }

    this.logEvent('tool_result', { toolName: tc.function.name, result: { success: result.success, error: result.error || null } });

    // ── Hook: afterToolCall（数据脱敏 / 截断 / 格式化）──
    const afterToolRes = await executeHooks<AfterToolCallContext>(this.hooks?.afterToolCall, {
      toolName: tc.function.name,
      args,
      output: result.output,
      error: result.error,
      sessionId: this.sessionId,
      iteration,
    });
    if (afterToolRes.aborted) {
      const msg = `Hook aborted after tool ${tc.function.name}: ${afterToolRes.message}`;
      this.logEvent('error', { content: msg });
      return { output: msg, error: 'HOOK_ABORTED' };
    }
    // Hook 可修改 output（脱敏/截断）
    const finalOutput = afterToolRes.ctx.output;

    return { output: finalOutput, error: result.error };
  }

  private async waitForApproval(
    toolName: string,
    args: Record<string, unknown>,
    approvalKey: string,
    timeoutMs: number
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (!approvalKey) {
      return { success: false, output: 'Approval key missing', error: 'PENDING_APPROVAL' };
    }
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const approvals = getToolApprovals();
      const token = approvals.get(approvalKey);

      if (token === '__DENIED__') {
        approvals.delete(approvalKey);
        return {
          success: false,
          output: `Tool '${toolName}' was denied by the user.`,
          error: 'APPROVAL_DENIED',
        };
      }

      if (token) {
        const result = await executeTool(toolName, args, {
          sessionId: this.sessionId,
          approvalToken: token,
          agentConfig: this.config,
          llmCallId: this.currentLlmCallId ?? undefined,
        } as any);
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Timeout — auto-deny
    const approvals = getToolApprovals();
    approvals.delete(approvalKey);
    return {
      success: false,
      output: `Tool '${toolName}' approval timed out after ${timeoutMs / 1000}s. The tool was not executed.`,
      error: 'APPROVAL_TIMEOUT',
    };
  }

  private normalizeResponse(resp: any): { content: string; toolCalls: ToolCall[] } {
    // OpenAI format
    const oaChoice = resp.choices?.[0]?.message;
    if (oaChoice) {
      return {
        content: oaChoice.content || '',
        toolCalls: oaChoice.tool_calls || [],
      };
    }
    // Anthropic format
    if (resp.content) {
      const texts: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const block of resp.content) {
        if (block.type === 'text') texts.push(block.text);
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }
      return { content: texts.join('\n'), toolCalls };
    }
    return { content: '', toolCalls: [] };
  }

  private async callLLM(): Promise<unknown> {
    const primary = {
      provider: this.config.provider,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
    };
    const chain = [primary, ...(this.config.fallbacks || [])];
    let lastErr: unknown;
    for (const c of chain) {
      try {
        // Level 1: 指数退避，应对 Rate Limit / 网络抖动（非瞬时错误直接放弃，不重试）
        for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            const delay = Math.min(
              LLM_BACKOFF_BASE_MS * Math.pow(2, attempt - 1),
              LLM_BACKOFF_MAX_MS
            );
            this.logEvent('backoff', { model: c.model, content: `attempt=${attempt} delayMs=${delay}` });
            await new Promise<void>(r => setTimeout(r, delay));
          }
          try {
            const r = await this.callLLMWith({ ...this.config, ...c });
            if (r) return r;
          }
          catch (e: any) {
            if (e instanceof NonRetriableError) throw e; // 401/400 等：立即放弃
            lastErr = e; // 瞬时错误：继续下一次 attempt
          }
        }
      } catch (e: any) {
        lastErr = e;
        if (e instanceof NonRetriableError) break; // 非瞬时：不再尝试 fallback provider
      }
    }
    if (lastErr) logger.error('All model attempts failed:', (lastErr as Error).message);
    return null;
  }

  /** Run a single model call with a (possibly fallback) config. */
  private async callLLMWith(cfg: AgentConfig): Promise<unknown> {
    if (cfg.signal?.aborted) return null; // 断连中止：不再发起新 LLM 调用
    const saved = this.config;
    this.config = cfg;
    try {
      const provider = (cfg.provider || '').toLowerCase();
      if (provider === 'anthropic') return await this.callAnthropic();
      return await this.callOpenAI();
    } finally {
      this.config = saved;
    }
  }

  private async callOpenAI(): Promise<unknown> {
    const { OpenAI } = await import('openai');
    const baseUrl = this.config.baseUrl || 'http://localhost:11434/v1';
    const apiKey = this.config.apiKey || 'ollama';

    // timeout：防止模型端挂起拖死整轮（SDK 默认无超时）；重试由外层指数退避接管，SDK 自身不重试
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 60000, maxRetries: 0 });

    const tools = toolRegistry.getSchemas().map(s => ({
      type: 'function' as const,
      function: {
        name: s.name,
        description: s.description,
        parameters: s.parameters,
      },
    }));

    const apiMessages = this.messages.map(m => {
      if (m.role === 'system') return { role: 'system' as const, content: m.content };
      if (m.role === 'user') return { role: 'user' as const, content: m.content };
      if (m.role === 'tool') return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id! };
      if (m.role === 'assistant') {
        const msg: any = { role: 'assistant' as const, content: m.content || null };
        if (m.tool_calls?.length) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }));
        }
        return msg;
      }
      return { role: 'user' as const, content: m.content };
    });

    try {
      return await client.chat.completions.create({
        model: this.config.model,
        messages: apiMessages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: false,
        // 思考模式：向 OpenAI 兼容接口传递 reasoning_effort（o 系列 / gpt-5 等推理模型）
        ...(this.config.thinkingMode ? { reasoning_effort: 'high' as const } : {}),
      });
    } catch (err: unknown) {
      // 非瞬时错误（401/400/404 等）直接上抛——外层不再退避重试、不再尝试 fallback
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!this.isRetriable(err)) throw new NonRetriableError(errMsg || 'LLM call failed');
      logger.error('LLM call failed:', errMsg);
      try {
        // 重试时去掉 tools 与 reasoning_effort：部分模型/网关不接受思考参数
        return await client.chat.completions.create({
          model: this.config.model,
          messages: apiMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          stream: false,
        });
      } catch (e2: unknown) {
        const e2Msg = e2 instanceof Error ? e2.message : String(e2);
        logger.error('Fallback failed:', e2Msg);
        return null; // 瞬时错误重试一次仍失败 → 外层指数退避重试
      }
    }
  }

  /** 仅对 429/5xx/网络类错误重试；4xx（401/400/404 等）是确定性的，重试无意义。 */
  private isRetriable(err: unknown): boolean {
    if (!err) return false;
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = e.status ?? e.statusCode;
    if (typeof status === 'number') return status === 408 || status === 429 || status >= 500;
    return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|timeout/i.test(String(e.message ?? err));
  }

  private async callAnthropic(): Promise<unknown> {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com';
    const apiKey = this.config.apiKey || '';
    if (!apiKey) throw new Error('Anthropic API key is required');

    const client = new Anthropic({
      apiKey,
      baseURL: baseUrl.endsWith('/v1') ? baseUrl.replace('/v1', '') : baseUrl,
      timeout: 60000, // 防止模型端挂起拖死整轮
    });

    const tools = toolRegistry.getSchemas().map(s => ({
      name: s.name,
      description: s.description,
      input_schema: s.parameters,
    }));

    const anthropicMessages: any[] = [];
    let systemPrompt = '';
    for (const m of this.messages) {
      if (m.role === 'system') {
        systemPrompt = m.content;
        continue;
      }
      if (m.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
        });
        continue;
      }
      if (m.role === 'user') {
        anthropicMessages.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
      } else if (m.role === 'assistant') {
        const content: unknown[] = m.content ? [{ type: 'text', text: m.content }] : [];
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content });
      }
    }

    const thinking = this.config.thinkingMode
      ? {
          type: 'enabled' as const,
          // Anthropic 要求 budget_tokens ∈ [1024, max_tokens)
          budget_tokens: Math.min(
            this.config.thinkingBudgetTokens || 2048,
            Math.max(1024, Math.floor(this.config.maxTokens * 0.5))
          ),
        }
      : undefined;

    return await client.messages.create({
      model: this.config.model,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: this.config.maxTokens,
      // extended thinking 要求不传 temperature（或 =1）
      ...(thinking ? { thinking } : { temperature: this.config.temperature }),
    });
  }

  private saveSession(): void {
    try {
      const db = getDb();
      const summary = JSON.stringify(this.messages.slice(-3).map(m => ({ role: m.role, content: m.content?.substring(0, 200) })));
      db.prepare(`UPDATE sessions SET updated_at = datetime('now'), summary = ? WHERE id = ?`)
        .run(summary.substring(0, 1000), this.sessionId);
    } catch { /* best-effort session update */ }
  }

  getMessages(): AgentMessage[] { return this.messages; }

  /** Replaces the entire message list (used by context compressor). */
  _replaceMessages(messages: AgentMessage[]): void {
    this.messages = messages;
  }
}
