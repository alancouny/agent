/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// StateGraph — LangGraph-style graph runtime.
//
// 用法：
//   const graph = new StateGraph()
//     .addNode('router',      routerNode)
//     .addNode('supervisor',  supervisorNode)
//     .addNode('delegate',    delegateNode)
//     .addNode('complete',    completeNode)
//     .addNode('error',       errorNode)
//     .addEdge('router',      'supervisor', { edge: 'loop' })
//     .addEdge('router',      'delegate',   { edge: 'delegate' })
//     .addEdge('router',      'complete',   { edge: 'complete' })
//     .addEdge('router',      'error',      { edge: 'error' })
//     .addEdge('supervisor',  'router',     { edge: 'loop' })
//     .addEdge('supervisor',  'complete',   { edge: 'done' })
//     .addEdge('supervisor',  'error',      { edge: 'error' })
//     .addEdge('delegate',    'complete',   { edge: 'complete' })
//     .addEdge('delegate',    'error',      { edge: 'error' })
//     .addEdge('complete',    '__end__')
//     .addEdge('error',       '__end__')
//     .setEntryPoint('router');
//
//   for await (const ev of graph.run(initialState, outStream)) {
//     console.log(ev);
//   }
// ============================================================

import type { AgentStreamEvent } from '../agent/types.js';
import type {
  WorkflowState, WorkflowNodeId, WorkflowEdge,
  WorkflowNodeFn, WorkflowEdgeFn, NodeResult,
} from './types.js';
import { sessionEvents } from '../session/events.js';
import type { SessionEventType } from '../session/events.js';
import {
  routerNode, supervisorNode, delegateNode,
  completeNode, errorNode,
} from './nodes.js';

// ── 边定义（目标节点支持字符串 '__end__'）────────────────────
interface EdgeDef {
  from: WorkflowNodeId;
  to: WorkflowNodeId | '__end__';
  edge?: WorkflowEdge;
  edge_fn?: WorkflowEdgeFn;
}

// ── 事件通道：节点边执行边 emit，运行时边 yield（流式）────────
interface EventChannel {
  emit: (ev: AgentStreamEvent) => void;
  close: () => void;
  /** 异步迭代器：有事件就出，通道关闭且队列清空后结束。 */
  drain: () => AsyncGenerator<AgentStreamEvent>;
}

function createEventChannel(): EventChannel {
  const queue: AgentStreamEvent[] = [];
  let closed = false;
  return {
    emit: (ev) => { if (!closed) queue.push(ev); },
    close: () => { closed = true; },
    drain: async function* () {
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (closed) return;
        await new Promise((r) => setTimeout(r, 10)); // 轻量轮询，保持简单可靠
      }
    },
  };
}

// ── StateGraph ──────────────────────────────────────────────
export class StateGraph {
  private nodes = new Map<WorkflowNodeId, WorkflowNodeFn>();
  private edges: EdgeDef[] = [];
  private entryPoint: WorkflowNodeId | null = null;
  private maxSteps = 50;

  constructor() {}

  addNode(id: WorkflowNodeId, fn: WorkflowNodeFn): this {
    this.nodes.set(id, fn);
    return this;
  }

  addEdge(from: WorkflowNodeId, to: WorkflowNodeId | '__end__', opts?: {
    edge?: WorkflowEdge;
    edge_fn?: WorkflowEdgeFn;
  }): this {
    this.edges.push({ from, to, edge: opts?.edge, edge_fn: opts?.edge_fn });
    return this;
  }

  setEntryPoint(nodeId: WorkflowNodeId): this {
    this.entryPoint = nodeId;
    return this;
  }

  /**
   * 从初始状态开始执行图，异步生成事件流。
   * 当 state.done === true 或达到 maxSteps 时终止。
   */
  async *run(
    initialState: WorkflowState,
    outStream?: AsyncGenerator<AgentStreamEvent>
  ): AsyncGenerator<AgentStreamEvent> {
    if (!this.entryPoint) throw new Error('StateGraph: no entry point set');

    let state = { ...initialState };
    let current: WorkflowNodeId = this.entryPoint;
    let steps = 0;

    while (!state.done && steps < this.maxSteps) {
      steps++;
      state.currentNode = current;
      this.logEvent(state, 'workflow_step', { currentNode: current, step: steps });

      const nodeFn = this.nodes.get(current);
      if (!nodeFn) {
        const msg = `StateGraph: unknown node '${current}'`;
        this.logEvent(state, 'error', { content: msg });
        yield { type: 'error', error: msg, turnIdx: 0, stepIdx: steps };
        break;
      }

      const nodeInput = this.buildInput(current, state, outStream);

      try {
        // ── 节点 + 事件通道并行：节点边执行边 emit，运行时边 yield ──
        const channel = createEventChannel();
        nodeInput.emit = channel.emit;

        let nodeResult: NodeResult | null = null;
        let nodeError: unknown = null;
        const nodePromise = (async () => {
          try {
            nodeResult = await nodeFn(nodeInput);
          } catch (err) {
            nodeError = err;
          } finally {
            channel.close();
          }
        })();

        // 排水泵：直到节点完成（通道关闭）才结束
        for await (const ev of channel.drain()) {
          yield ev;
        }
        await nodePromise;
        if (nodeError) throw nodeError;
        const result: NodeResult = nodeResult!;
        state = result.state;

        // yield 节点产出的 pendingEvents（返回后统一 yield 的兼容路径）
        if (state.pendingEvents?.length) {
          for (const ev of state.pendingEvents) yield ev;
          state.pendingEvents = [];
        }

        const nextEdge = result.edge ?? this.resolveEdge(state, result);
        const nextNode = this.resolveTarget(current, nextEdge);

        // 转发节点 events 字段（兼容旧路径）
        if (result.events) {
          const evs = Array.isArray(result.events) ? result.events : [...(result.events as any)];
          for (const ev of evs) yield ev;
        }

        if (nextNode === '__end__') {
          state.done = true;
          this.logEvent(state, 'workflow_complete', { steps, finalNode: current });
          break;
        }

        current = nextNode;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        state.errors.push(msg);
        this.logEvent(state, 'error', { content: msg });
        yield { type: 'error', error: msg, turnIdx: 0, stepIdx: steps };
        current = 'error';
      }
    }

    if (steps >= this.maxSteps && !state.done) {
      const msg = `StateGraph: reached max steps (${this.maxSteps}) without completing`;
      this.logEvent(state, 'error', { content: msg });
      yield { type: 'error', error: msg, turnIdx: 0, stepIdx: steps };
    }
  }

  // ── 私有辅助 ────────────────────────────────────────────

  private buildInput(nodeId: WorkflowNodeId, state: WorkflowState, stream?: AsyncGenerator<AgentStreamEvent>): any {
    const base = { state, messages: state.messages, stream };
    switch (nodeId) {
      case 'router':      return base;
      case 'supervisor':  return base;
      case 'delegate': {
        const d = state.decision as unknown as Record<string, unknown>;
        return { ...base, taskId: d?.taskId ?? `task-${Date.now()}`, task: d?.task ?? '', agentType: d?.agentType };
      }
      case 'complete':    return base;
      case 'error':       return { ...base, error: state.errors.at(-1) ?? 'unknown', recoverable: state.errors.length < 3 };
      default:            return base;
    }
  }

  /** 根据边标签解析出目标节点 */
  private resolveTarget(from: WorkflowNodeId, edge?: WorkflowEdge): WorkflowNodeId | '__end__' {
    // 优先匹配静态 edge（无 edge_fn）
    const staticMatch = this.edges.find(e => e.from === from && e.edge === edge && !e.edge_fn);
    if (staticMatch) return staticMatch.to;

    // 其次匹配 edge_fn（动态路由）
    const fnMatch = this.edges.find(e => e.from === from && !!e.edge_fn);
    if (fnMatch) return fnMatch.to;

    // fallback: 取第一条 from 匹配的边
    const first = this.edges.find(e => e.from === from);
    return first?.to ?? '__end__';
  }

  private resolveEdge(state: WorkflowState, result: NodeResult): WorkflowEdge | undefined {
    if (result.edge) return result.edge;
    const d = state.decision as unknown as Record<string, unknown>;
    if (!d) return undefined;
    if (d.kind === 'delegate') return 'delegate';
    if (d.kind === 'loop') return 'loop';
    if (d.kind === 'done' || d.kind === 'reply') return 'complete';
    if (d.kind === 'error') return 'error';
    return undefined;
  }

  private logEvent(state: WorkflowState, type: SessionEventType, extra: Record<string, unknown> = {}) {
    try {
      // Fire-and-forget: never block the workflow node on log errors.
      sessionEvents.append({
        sessionId: state.sessionId,
        type,
        ...extra,
      }).catch(() => { /* best-effort */ });
    } catch { /* non-critical */ }
  }
}

// ── 预置 Supervisor Workflow 工厂 ───────────────────────────
export function buildSupervisorWorkflow(): StateGraph {
  return new StateGraph()
    .addNode('router',       routerNode)
    .addNode('supervisor',   supervisorNode)
    .addNode('delegate',     delegateNode)
    .addNode('complete',     completeNode)
    .addNode('error',        errorNode)
    // router → 各决策目标
    .addEdge('router', 'supervisor',  { edge: 'loop' })
    .addEdge('router', 'delegate',    { edge: 'delegate' })
    .addEdge('router', 'complete',    { edge: 'complete' })
    .addEdge('router', 'error',       { edge: 'error' })
    // supervisor → 继续 / 完成 / 错误
    .addEdge('supervisor', 'router',   { edge: 'loop' })
    .addEdge('supervisor', 'complete', { edge: 'done' })
    .addEdge('supervisor', 'error',    { edge: 'error' })
    // delegate → 汇总 / 错误
    .addEdge('delegate', 'complete', { edge: 'complete' })
    .addEdge('delegate', 'error',    { edge: 'error' })
    // 终态
    .addEdge('complete', '__end__')
    .addEdge('error',    '__end__')
    .setEntryPoint('router');
}
