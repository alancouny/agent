// ============================================================
// Agent meta-tools — DeepSeek Harness patterns:
//   delegate_task — sub-agent delegation (scoped, read-only tools)
//   run_code      — PTC (Programmatic Tool Calling): model writes one
//                   program that composes multiple tool calls, reducing
//                   model⇄tool round-trips.
// ============================================================

import { toolRegistry, executeTool, type ToolContext } from '../tools/registry.js';
import { delegateTask, scopedReadOnlyTools } from '../agents/delegate.js';
import { blackboard } from '../shared/blackboard.js';
import { runInIsolatedVm } from '../sandbox/isolated.js';

// ── delegate_task ──
toolRegistry.register('delegate_task', {
  schema: {
    name: 'delegate_task',
    description:
      'Delegate a self-contained subtask to a sub-agent. The sub-agent has its own scoped context and may use read-only tools (search, file listing, calculation). Use for parallel investigations or to keep your own context clean. Returns the sub-agent\'s final answer as text.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The self-contained task for the sub-agent, with all needed context' },
        allowedTools: {
          type: 'array',
          description: 'Optional tool whitelist for the sub-agent (defaults to read-only tools)',
          items: { type: 'string' },
        },
      },
      required: ['task'],
    },
  },
  handler: async ({ task, allowedTools }, ctx: ToolContext) => {
    if (!task || !String(task).trim()) {
      return { success: false, output: 'task is required', error: 'TASK_REQUIRED' };
    }
    const config = ctx.agentConfig || {};
    const result = await delegateTask({
      task: String(task),
      config: {
        provider: config.provider || 'openai',
        model: config.model || 'gpt-4o',
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        maxIterations: 1,
        maxTokens: 2048,
        temperature: 0.4,
        systemPrompt: '',
      },
      allowedTools: Array.isArray(allowedTools) ? allowedTools.map(String) : scopedReadOnlyTools(),
      errorBudget: 3,
      sessionId: ctx.sessionId || 'delegate',
      parentCallId: ctx.llmCallId ?? null,
    });

    // 将子 Agent 产出写入黑板，父 Agent 及其他子 Agent 可读取
    blackboard.set(`delegate:${ctx.sessionId}:${Date.now()}`, result, ctx.sessionId);

    if (result.ok) {
      return {
        success: true,
        output: `[sub-agent (${result.toolCalls} tool calls)]\n${result.output}`,
        data: { toolCalls: result.toolCalls },
      };
    } else {
      return {
        success: false,
        output: `DelegateTask failed: ${result.error || 'unknown error'} (tried ${result.errorCount + 1} attempts)`,
        error: result.error || 'DELEGATE_FAILED',
      };
    }
  },
  category: 'agent',
  requiresApproval: false,
  readOnly: false,
  enabled: true,
});

// ── run_code (PTC mode) ──
toolRegistry.register('run_code', {
  schema: {
    name: 'run_code',
    description:
      'PTC (Programmatic Tool Calling): write a TypeScript/JavaScript program that composes MULTIPLE tool calls in one request, then call it. Available in the sandbox: `tools` (tool call helper) and `JSON`/`Math`/`console`. Example: const a = await tools.call("web_search", { query: "x" }); const b = await tools.call("calculator", { expression: "1+1" }); return [a, b].join("\\n"); — return a string.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript program. Use `await tools.call(name, args)` for tool calls. The final expression or a `return` value (string) is the result.' },
        description: { type: 'string', description: 'One-line description of what this program does (required for logging)' },
      },
      required: ['code', 'description'],
    },
  },
  handler: async ({ code, description }, ctx: ToolContext) => {
    if (!code || !String(code).trim()) {
      return { success: false, output: 'code is required', error: 'CODE_REQUIRED' };
    }
    try {
      // Safe tool bridge: only exposes toolRegistry-based calls, no fs/net access.
      const allowedTools = new Set(
        toolRegistry
          .getAll()
          .filter(([, def]) => def.enabled)
          .map(([name]) => name)
      );

      // isolated-vm 真沙箱：独立 V8 isolate，128MB 内存上限 + 30s 超时，
      // 无 process/require 全局（node:vm 存在原型链逃逸风险，这里替换掉）
      const sandbox = await runInIsolatedVm(String(code), {
        toolsCall: async (name: string, args: Record<string, unknown>) => {
          if (!allowedTools.has(String(name))) {
            return `TOOL_NOT_ALLOWED: ${name}`;
          }
          try {
            const result = await executeTool(String(name), args || {}, {
              sessionId: ctx.sessionId || 'run_code',
            });
            return result.success ? result.output : `TOOL_ERROR(${result.error}): ${result.output}`;
          } catch (e: unknown) {
            return `TOOL_EXCEPTION: ${(e as Error).message}`;
          }
        },
        toolsList: () => toolRegistry.getSchemas().map((s) => s.name),
      });

      const output = sandbox.value;
      const log = sandbox.logs.length ? '\n[console]\n' + sandbox.logs.join('\n') : '';
      const limitNote = sandbox.timedOut
        ? '\n[sandbox] execution timed out (30s)'
        : sandbox.memoryLimited
          ? '\n[sandbox] memory limit exceeded (128MB)'
          : '';
      return {
        success: true,
        output: `run_code: ${description || 'ptc program'}\n${output || '(no value returned)'}${log}${limitNote}`,
        data: { description: description || '', result: output },
      };
    } catch (e: unknown) {
      const err = e as Error;
      const stack = err?.stack ? `\nStack:\n${err.stack}` : '';
      return { success: false, output: `run_code error: ${err.message}${stack}`, error: err.message };
    }
  },
  category: 'agent',
  requiresApproval: true,
  enabled: true,
});
