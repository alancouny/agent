// ============================================================
// Workflow State Machine — LangGraph-style StateGraph for agent
// handoff and sub-agent delegation.
//
// Nodes (state transformers):
//   router      — 路由决策：直接回复 / 委托子 Agent / 失败
//   supervisor  — 执行 AgentCore.ReAct 循环，产出中间结果
//   delegate    — 跑 delegateTask()，产生子 Agent 最终答案
//   complete    — 汇总所有子任务结果，yield final answer
//   error       — 错误处理：记录并上报，不崩溃
//
// 流转示例：
//   START → router
//   router → supervisor  |  router → delegate  |  router → complete  |  router → error
//   supervisor → router (loop)  |  supervisor → complete  |  supervisor → error
//   delegate → complete  |  delegate → error
// ============================================================

import type { AgentStreamEvent, AgentConfig, AgentMessage } from '../agent/types.js';
import type { DelegateResult } from '../agents/delegate.js';

// ── 节点名称 ────────────────────────────────────────────────
export type WorkflowNodeId = 'router' | 'supervisor' | 'delegate' | 'complete' | 'error';

// ── 边标签 ──────────────────────────────────────────────────
export type WorkflowEdge =
  | 'direct_reply'   // router → complete（LLM 直接回答）
  | 'delegate'       // router → delegate
  | 'loop'           // supervisor → router（继续 ReAct 循环）
  | 'done'           // supervisor → complete（循环结束）
  | 'complete'       // delegate / router → complete（子任务完成）
  | 'error';         // 任意节点 → error

// ── 路由决策（routerNode 产出）───────────────────────────────
export type RoutingDecision =
  | { kind: 'reply';    text: string }
  | { kind: 'delegate'; taskId: string; task: string; agentType?: string }
  | { kind: 'loop';     reason?: string }   // 交给 supervisor 执行 ReAct 循环
  | { kind: 'error';    message: string; recoverable?: boolean }
  | { kind: 'done';     reason?: string };

// ── 节点输入 / 输出 ─────────────────────────────────────────
/** 所有节点共享的基类输入，具体节点按需读取所需字段 */
export interface BaseNodeInput {
  state: WorkflowState;
  messages: AgentMessage[];
  stream?: AsyncGenerator<AgentStreamEvent>;
  /**
   * 实时事件通道：节点内部可边执行边把事件推给 graph 运行时，
   * 由运行时立即 yield 给调用方（流式/打字机效果）。
   * 与 state.pendingEvents（节点返回后统一 yield）互补。
   */
  emit?: (ev: AgentStreamEvent) => void;
}

export type RouterInput     = BaseNodeInput;
export type SupervisorInput = BaseNodeInput;
export interface DelegateInput   extends BaseNodeInput {
  taskId: string;
  task: string;
  agentType?: string;
}
export type CompleteInput = BaseNodeInput;
export interface ErrorInput      extends BaseNodeInput {
  error: string;
  recoverable?: boolean;
}

export type NodeInput = BaseNodeInput & Partial<DelegateInput> & Partial<ErrorInput>;

// ── 节点输出：携带新 state 和可选边标签 ──────────────────────
export interface NodeResult {
  /** 更新后的 workflow state */
  state: WorkflowState;
  /** 指定跳转的目标边；undefined = 由运行时根据 state.nextAction 自动选择 */
  edge?: WorkflowEdge;
  /** 在 stream 中额外 yield 的事件（可选） */
  events?: AsyncGenerator<AgentStreamEvent> | AgentStreamEvent[];
}

// ── 工作流状态（LangGraph 风格的可变 shared state）────────────
export interface WorkflowState {
  /** 当前节点名称（运行时由 StateGraph 更新） */
  currentNode: WorkflowNodeId;
  /** 上一步的边标签 */
  prevEdge?: WorkflowEdge;
  /** 本轮工作流的根 session（与 AgentCore.sessionId 对齐） */
  sessionId: string;
  /** 顶层配置（传给所有节点） */
  config: AgentConfig;
  /** 消息历史（由 supervisor / router 维护） */
  messages: AgentMessage[];
  /** 用户原始请求 */
  userMessage: string;
  /** 所有已完成的子任务 */
  subTasks: SubTaskResult[];
  /** 路由决策（由 routerNode 写入） */
  decision?: RoutingDecision;
  /** 累计 token 用量 */
  totalTokens: number;
  /** 累计 LLM 调用次数 */
  llmCalls: number;
  /** 累计 tool 调用次数 */
  toolCalls: number;
  /** 累计子 agent 调用次数 */
  delegateCalls: number;
  /** 已发生错误列表（供 errorNode 汇总） */
  errors: string[];
  /** 是否已完成 */
  done: boolean;
  /** 节点产出的待转发事件（由 graph 运行时 yield 给调用方） */
  pendingEvents?: AgentStreamEvent[];
}

export function makeInitialState(opts: {
  sessionId: string;
  config: AgentConfig;
  messages: AgentMessage[];
  userMessage: string;
}): WorkflowState {
  return {
    currentNode: 'router',
    sessionId: opts.sessionId,
    config: opts.config,
    messages: opts.messages,
    userMessage: opts.userMessage,
    subTasks: [],
    totalTokens: 0,
    llmCalls: 0,
    toolCalls: 0,
    delegateCalls: 0,
    errors: [],
    done: false,
  };
}

// ── 子任务结果（delegate 节点产出，写入 state.subTasks）──────
export interface SubTaskResult {
  id: string;
  agentType?: string;
  ok: boolean;
  output: string;
  error?: string;
  delegateResult: DelegateResult;
  completedAt: string;
}

// ── 边路由函数签名 ──────────────────────────────────────────
export type WorkflowEdgeFn = (state: WorkflowState, result: NodeResult) => WorkflowEdge;

// ── 节点函数签名 ────────────────────────────────────────────
export type WorkflowNodeFn = (input: NodeInput) => Promise<NodeResult>;

// ── 图定义 ──────────────────────────────────────────────────
export interface WorkflowEdgeDef {
  from: WorkflowNodeId;
  /** 'default' 表示无条件边；其他字符串可被 edge_fn 用来做条件分支 */
  to: WorkflowNodeId | 'default';
  edge?: WorkflowEdge;
  edge_fn?: WorkflowEdgeFn;
}

export interface WorkflowNodeDef {
  id: WorkflowNodeId;
  fn: WorkflowNodeFn;
}

export interface WorkflowGraphDef {
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  /** 起始节点 */
  entryPoint: WorkflowNodeId;
}
