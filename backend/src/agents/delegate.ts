/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// Sub-agent delegation (DeepSeek Harness: one Agent can delegate
// to a child Agent that has its own scoped context and tools).
//
// Architecture (3 levels):
//   Level 1 — Router/Supervisor AgentCore.run()
//     ↓ delegate_task tool
//   Level 2 — Format Retry Loop (within delegateTask OpenAI path)
//     If the model returns an empty / malformed response, inject
//     a correction hint and retry up to FORMAT_RETRY_LIMIT times.
//   Level 3 — Reflection Loop (run_code error path)
//     On tool/VM failure, stack trace is written to session_events
//     (type='reflection'), then the sub-agent is re-invoked with
//     the error context appended to its prompt, up to
//     opts.errorBudget attempts.
//
// When the error budget is exhausted the result carries ok=false
// so the parent router can delegate elsewhere or report failure.
// ============================================================

import type { AgentConfig } from '../agent/types.js';
import { llmTracer } from '../telemetry/llm-trace.js';
import { toolRegistry, type ToolDefinition } from '../tools/registry.js';

export interface DelegateOptions {
  task: string;
  config: AgentConfig;
  /** Whitelist of tool names the child may use (default: read-only ones). */
  allowedTools?: string[];
  maxTokens?: number;
  /**
   * How many times the sub-agent is allowed to re-attempt after a runtime/tool error.
   * Each retry receives the previous stack trace injected into its prompt.
   * Defaults to 3. Set to 0 to disable reflection.
   */
  errorBudget?: number;
  /** Override the system prompt used by the sub-agent. */
  subAgentSystemPrompt?: string;
  /** 瀑布图：子调用归属的会话。 */
  sessionId?: string;
  /** 瀑布图：触发本子调用的父 LLM 调用 id。 */
  parentCallId?: string | null;
}

export interface DelegateResult {
  ok: boolean;
  output: string;
  error?: string;
  toolCalls: number;
  /** How many reflection retries were consumed (for diagnostic / budget tracking). */
  errorCount: number;
}

const DELEGATE_SYSTEM_PROMPT = `You are a sub-agent. Complete the delegated task using ONLY the tools available to you. Be concise and factual. Return your final answer as plain text. If you cannot complete the task, say so clearly and explain what blocked you.`;



/** Maximum format-retry attempts when the model returns an empty/malformed response. */
const FORMAT_RETRY_LIMIT = 3;
/** Maximum total reflection attempts (incl. the original call). */
const DEFAULT_ERROR_BUDGET = 3;

/** Names that are safe for a scoped child (read-only, no approval needed). */
export function scopedReadOnlyTools(): string[] {
  return toolRegistry
    .getAll()
    .filter(([, def]) => def.readOnly && !def.requiresApproval)
    .map(([name]) => name);
}

/** Append an error-context message to the prompt for the next reflection attempt. */
function buildReflectionPrompt(baseTask: string, errorContext: string): string {
  return `${baseTask}\n\n--- Previous attempt failed ---\n${errorContext}\n\nPlease produce a corrected result.`;
}

export async function delegateTask(opts: DelegateOptions): Promise<DelegateResult> {
  const allowed = new Set(opts.allowedTools || scopedReadOnlyTools());
  const schemas = toolRegistry
    .getAll()
    .filter(([name, def]) => allowed.has(name) && def.enabled)
    .map(([name, def]) => ({
      name,
      description: def.schema.description,
      parameters: def.schema.parameters,
      requiresApproval: def.requiresApproval,
      readOnly: !!def.readOnly,
    }));

  const systemPrompt = opts.subAgentSystemPrompt || DELEGATE_SYSTEM_PROMPT;
  const errorBudget = opts.errorBudget ?? DEFAULT_ERROR_BUDGET;
  const provider = (opts.config.provider || '').toLowerCase();
  let toolCalls = 0;
  let errorCount = 0;

  // ── Anthropic path (single-shot, no internal retry loop) ────────
  if (provider === 'anthropic') {
    try {
      const { Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey: opts.config.apiKey || '',
        baseURL: (opts.config.baseUrl || 'https://api.anthropic.com').replace(/\/v1$/, ''),
        timeout: 60000,
      });
      const tid = llmTracer.begin({
        sessionId: opts.sessionId || 'delegate',
        agentKind: 'delegate',
        parentId: opts.parentCallId ?? null,
        model: opts.config.model,
        turn: 0,
        step: 0,
      });
      let resp: any;
      try {
        resp = await client.messages.create({
          model: opts.config.model,
          system: systemPrompt,
          max_tokens: opts.maxTokens || 2048,
          messages: [{ role: 'user', content: [{ type: 'text', text: opts.task }] }],
          tools: schemas.map((s) => ({
            name: s.name,
            description: s.description,
            input_schema: s.parameters,
          })),
        });
        llmTracer.end(tid, {
          promptTokens: resp.usage?.input_tokens ?? 0,
          completionTokens: resp.usage?.output_tokens ?? 0,
          contentPreview: Array.isArray(resp.content) ? resp.content.map((b: any) => b.text || '').join('').slice(0, 120) : '',
        });
      } catch (e) {
        llmTracer.end(tid, { failed: true, contentPreview: e instanceof Error ? e.message : String(e) });
        throw e;
      }

      const text: string[] = [];
      for (const block of resp.content as any[]) {
        if (block.type === 'text') text.push(block.text);
      }
      return { ok: true, output: text.join('\n'), toolCalls, errorCount };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, output: '', toolCalls, errorCount, error: msg };
    }
  }

  // ── OpenAI-compatible path (includes DeepSeek / Ollama / vLLM) ─
  const { OpenAI } = await import('openai');
  const client = new OpenAI({
    baseURL: opts.config.baseUrl || 'http://localhost:11434/v1',
    apiKey: opts.config.apiKey || 'ollama',
    timeout: 60000,
    maxRetries: 0,
  });

  const runWithPrompt = async (prompt: string): Promise<{ text: string; tc: number; err?: string }> => {
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    let cur = prompt;
    let totalToolCalls = 0;
    let formatRetries = 0;
    let finalText = '';

    while (true) {
      const tid = llmTracer.begin({
        sessionId: opts.sessionId || 'delegate',
        agentKind: 'delegate',
        parentId: opts.parentCallId ?? null,
        model: opts.config.model,
        turn: 0,
        step: 0,
      });
      try {
        const resp = await client.chat.completions.create({
          model: opts.config.model,
          messages: [
            ...messages,
            { role: 'user', content: cur },
          ],
          tools: schemas.length
            ? schemas.map((s) => ({
                type: 'function' as const,
                function: { name: s.name, description: s.description, parameters: s.parameters },
              }))
            : undefined,
          max_tokens: opts.maxTokens || 2048,
        });
        llmTracer.end(tid, {
          promptTokens: resp.usage?.prompt_tokens ?? 0,
          completionTokens: resp.usage?.completion_tokens ?? 0,
          toolNames: (resp.choices?.[0]?.message?.tool_calls || []).map((tc: any) => tc?.function?.name).filter(Boolean),
          contentPreview: resp.choices?.[0]?.message?.content || '',
        });

        const choice = resp.choices?.[0]?.message as any;
        const toolCallsResp = choice?.tool_calls || [];

        // ── Level 2: Format Retry Loop ──
        // If the model returned neither text nor valid tool_calls, inject a
        // correction hint and retry (up to FORMAT_RETRY_LIMIT times).
        if (!choice?.content && toolCallsResp.length === 0) {
          formatRetries++;
          if (formatRetries > FORMAT_RETRY_LIMIT) {
            return { text: '', tc: totalToolCalls, err: 'FORMAT_RETRY_EXHAUSTED' };
          }
          messages.push({ role: 'assistant', content: null, tool_calls: [] });
          messages.push({
            role: 'user',
            content: 'Your last response was empty. Please provide a concrete answer or call a tool with valid JSON arguments.',
          });
          continue;
        }

        if (toolCallsResp.length === 0) {
          finalText = choice?.content || '';
          break;
        }

        messages.push({ role: 'user', content: cur });
        messages.push({ role: 'assistant', content: choice?.content || null, tool_calls: toolCallsResp });

        const results: any[] = [];
        for (const tc of toolCallsResp) {
          const name = tc.function?.name;
          if (!allowed.has(name)) {
            results.push({ role: 'tool', tool_call_id: tc.id, content: `Tool '${name}' is not in the child's scope` });
            continue;
          }
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
          totalToolCalls++;
          const res = await executeScopedTool(name, args);
          results.push({ role: 'tool', tool_call_id: tc.id, content: res.output });
        }
        messages.push(...results);
        cur = ''; // subsequent iterations only need tool results, not re-sent user prompt
      } catch (llmErr: unknown) {
        // LLM network error — retry once with a reduced token budget
        formatRetries++;
        if (formatRetries > FORMAT_RETRY_LIMIT) {
          return { text: '', tc: totalToolCalls, err: (llmErr as Error).message };
        }
        continue;
      }
    }

    return { text: finalText, tc: totalToolCalls };
  };

  // ── Level 3: Reflection Loop ────────────────────────────────
  // If the sub-agent's execution fails (empty result or explicit error),
  // inject the error context and retry up to errorBudget times.
  let currentPrompt = opts.task;
  let lastErrorContext = '';

  for (let attempt = 0; attempt <= errorBudget; attempt++) {
    const { text, tc, err } = await runWithPrompt(currentPrompt);
    toolCalls += tc;
    currentPrompt = text; // next attempt uses previous output as base
    errorCount = attempt;

    // Success path: got a non-empty text result
    if (text && text.trim()) {
      return { ok: true, output: text, toolCalls, errorCount };
    }

    // Collect error context from this attempt
    const errDetail = err
      ? `[LLM error: ${err}]`
      : '[Sub-agent produced no output — task may be unsolvable with available tools.]';
    lastErrorContext = errDetail;

    // Exhausted budget → propagate failure upward
    if (attempt >= errorBudget) {
      return { ok: false, output: '', toolCalls, errorCount, error: `Delegate exhausted after ${errorBudget + 1} attempts. Last error: ${errDetail}` };
    }

    // Build reflection prompt and continue
    currentPrompt = buildReflectionPrompt(opts.task, lastErrorContext);
  }

  // Fallback (should not reach here, but keep the compiler happy)
  return {
    ok: false,
    output: '',
    toolCalls,
    errorCount,
    error: lastErrorContext || 'Unknown delegation error',
  };
}

/** Execute a scoped tool in the child context (never triggers approval UI; read-only only). */
async function executeScopedTool(name: string, args: any) {
  const def: ToolDefinition | undefined = toolRegistry.get(name);
  if (!def || !def.readOnly || def.requiresApproval) {
    return { success: false, output: `Tool '${name}' is not available to the sub-agent`, error: 'SCOPE_DENIED' };
  }
  try {
    return await def.handler(args, { sessionId: 'subagent' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Error: ${msg}`, error: msg };
  }
}
