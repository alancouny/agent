// ============================================================
// Agent Hook System — 允许开发者在 agent 主流程的关键阶段
// 注入自定义逻辑（日志、参数校验、请求拦截）。
//
// 触发时机（6 个）：
//   beforeRun       — Agent.run() 开始时，在构建 system prompt 之后
//   beforeModelCall — 调用 LLM 之前（OpenAI / Anthropic 兼容层之前）
//   afterModelCall  — LLM 响应回来后，路由到工具链之前
//   beforeToolCall  — executeTool() 之前
//   afterToolCall   — 工具执行返回后，结果注入 history 之前
//   afterRun        — 整个 turn 结束（完成/错误/达到 maxIterations）
//
// 控制流（3 种）：
//   { action: 'continue' }     — 继续执行，可选附带 payload 修改下一阶段的输入
//   { action: 'abort',  message } — 终止 agent，message 作为 error 事件发出
//   { action: 'modify', payload }  — 用 payload 修改当前阶段上下文后继续
//
// 多 hook 串联：
//   同一阶段可注册多个 hook，按注册顺序依次执行。
//   每个 hook 收到的上下文是上一个 hook 修改后的状态（chain pattern）。
//   任意一个 hook 返回 abort 则立即短路，后续 hook 不执行。
//
// 用法示例：
// ```ts
// const hooks: AgentHooksConfig = {
//   beforeToolCall: [
//     (ctx) => {
//       if (ctx.toolName === 'run_command' && ctx.args.command?.startsWith('rm -rf')) {
//         return { action: 'abort', message: 'Denied: dangerous command' };
//       }
//       return { action: 'continue' };
//     },
//   ],
//   afterModelCall: [
//     (ctx) => {
//       // 强制约束：若 LLM 有 tool_calls 则必须使用指定工具
//       if (ctx.toolCalls.length > 0 && !ctx.toolCalls.some(tc => SAFE_TOOL_NAMES.has(tc.function.name))) {
//         return { action: 'abort', message: 'Tool not in allow-list' };
//       }
//       return { action: 'continue' };
//     },
//   ],
//   afterToolCall: [
//     (ctx) => {
//       // 数据脱敏：将敏感字段替换为 [REDACTED]
//       const sensitive = ['password', 'token', 'secret', 'apiKey'];
//       const sanitized = JSON.stringify(ctx.args).replace(
//         new RegExp(`("(?:${sensitive.join('|')})":\\s*")[^"]*(")`, 'gi'),
//         '$1[REDACTED]$3'
//       );
//       return { action: 'modify', payload: { args: JSON.parse(sanitized) } };
//     },
//   ],
//   afterRun: [
//     async (ctx) => {
//       console.log(`[HOOK] Turn done. messages=${ctx.messages.length}, error=${ctx.error || 'none'}`);
//       return { action: 'continue' };
//     },
//   ],
// };
// const agent = new AgentCore({ ...config, hooks }, sessionId);
// ```
// ============================================================

import type { AgentMessage, AgentConfig, ToolCall } from './types.js';
import type { ToolSchema } from '../tools/registry.js';

// ── 控制流返回类型 ─────────────────────────────────────────────

/** Hook 可以返回的三种控制动作 */
export type HookAction = 'continue' | 'abort' | 'modify';

/** 上下文辅助类型：允许 Partial 操作任意字段 */
export type HookContext = Record<string, unknown>;

/**
 * Hook 执行结果。
 *
 * - action: 'continue' — 继续执行
 * - action: 'abort'    — 终止 agent，message 作为 error 事件 yield 给前端
 * - action: 'modify'   — 用 payload 合并修改当前阶段上下文后继续
 */
export interface HookResult<Payload extends HookContext> {
  action: HookAction;
  message?: string;
  payload?: Partial<Payload>;
}

// ── 阶段上下文类型 ─────────────────────────────────────────────

export interface BeforeRunContext {
  userMessage: string;
  sessionId: string;
  config: AgentConfig;
  messages: AgentMessage[];
  [key: string]: unknown;
}

export interface BeforeModelCallContext {
  apiMessages: unknown[];
  config: AgentConfig;
  iteration: number;
  toolSchemas: ToolSchema[];
  [key: string]: unknown;
}

export interface BeforeToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  toolSchema?: ToolSchema;
  sessionId: string;
  iteration: number;
  [key: string]: unknown;
}

// ── After 阶段上下文类型 ──────────────────────────────────────

/** LLM 响应解析后、路由到工具链之前。hook 可决定"继续走工具"或"拦截终止"。 */
export interface AfterModelCallContext {
  rawResponse: unknown;
  content: string;
  toolCalls: ToolCall[];
  iteration: number;
  config: AgentConfig;
  /** 若返回 abort，action 为 'abort' 时会立即终止本轮 agent turn */
  [key: string]: unknown;
}

/** 工具执行完成后、结果写入 history 之前。hook 可做数据脱敏 / 截断 / 格式化。 */
export interface AfterToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
  error?: string;
  sessionId: string;
  iteration: number;
  [key: string]: unknown;
}

/** 整个 turn 结束后（complete / error / max-iterations）。用于资源释放 / 摘要 / 最终事件。 */
export interface AfterRunContext {
  sessionId: string;
  messages: AgentMessage[];
  finalContent?: string;
  error?: string;
  maxIterations: number;
  actualIterations: number;
  config: AgentConfig;
  [key: string]: unknown;
}

// ── Hook 函数签名 ─────────────────────────────────────────────

export type BeforeRunHook = (ctx: BeforeRunContext) =>
  HookResult<BeforeRunContext> | Promise<HookResult<BeforeRunContext>>;

export type BeforeModelCallHook = (ctx: BeforeModelCallContext) =>
  HookResult<BeforeModelCallContext> | Promise<HookResult<BeforeModelCallContext>>;

export type BeforeToolCallHook = (ctx: BeforeToolCallContext) =>
  HookResult<BeforeToolCallContext> | Promise<HookResult<BeforeToolCallContext>>;

export type AfterModelCallHook = (ctx: AfterModelCallContext) =>
  HookResult<AfterModelCallContext> | Promise<HookResult<AfterModelCallContext>>;

export type AfterToolCallHook = (ctx: AfterToolCallContext) =>
  HookResult<AfterToolCallContext> | Promise<HookResult<AfterToolCallContext>>;

export type AfterRunHook = (ctx: AfterRunContext) =>
  HookResult<AfterRunContext> | Promise<HookResult<AfterRunContext>>;

// ── 配置类型 ──────────────────────────────────────────────────

export interface AgentHooksConfig {
  beforeRun?: BeforeRunHook[];
  beforeModelCall?: BeforeModelCallHook[];
  afterModelCall?: AfterModelCallHook[];
  beforeToolCall?: BeforeToolCallHook[];
  afterToolCall?: AfterToolCallHook[];
  afterRun?: AfterRunHook[];
}

// ── Hook 执行器（多 hook 串联 + abort 短路 + modify 合并） ─────

/**
 * 按注册顺序执行 hooks，返回最终合并后的上下文。
 *
 * - 默认行为：返回 `{ aborted: false, ctx }`
 * - 任意 hook 返回 abort：立即短路，返回 `{ aborted: true, ctx, message }`
 * - 任意 hook 返回 modify：payload 合并到 ctx，继续执行下一个 hook
 * - 任意 hook 返回 continue 或省略 action：继续执行下一个 hook
 */
export async function executeHooks<Ctx extends HookContext>(
  hooks: ((ctx: Ctx) => HookResult<Ctx> | Promise<HookResult<Ctx>>)[] | undefined,
  ctx: Ctx
): Promise<{ aborted: false; ctx: Ctx } | { aborted: true; ctx: Ctx; message: string }> {
  if (!hooks || hooks.length === 0) {
    return { aborted: false, ctx };
  }

  let current = { ...ctx } as Ctx;

  for (const hook of hooks) {
    const result = await hook(current);

    if (result.action === 'abort') {
      return { aborted: true, ctx: current, message: result.message || 'Hook aborted' };
    }

    if (result.payload) {
      current = { ...current, ...result.payload } as Ctx;
    }
  }

  return { aborted: false, ctx: current };
}