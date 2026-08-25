/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events';
import type { AgentStreamEvent } from './types.js';

/**
 * 事件总线：解耦 AgentCore 运行循环与传输层（SSE / 未来可订阅的遥测、可观测面板）。
 *
 * - `emitEvent()` 同时向「泛型 channel('event')」与「按 type 命名的 typed channel」广播，
 *   传输层只需监听 'event' 即可收到全部结构化事件；细粒度监听器可监听具体 type。
 * - 替代原先 `run()` 的 AsyncGenerator yield：调用方不再被生成器协议绑定，
 *   AgentCore 只需 `emit(event)` 即可向任意数量订阅者广播。
 */
export class AgentEventBus extends EventEmitter {
  constructor() {
    super();
    // EventEmitter 把 'error' 当作特殊事件：无监听器会 throw（Node 进程级）。
    // agent 事件里 type==='error' 会映射到该 channel，故挂一个 no-op 防止未处理抛错；
    // 业务侧仍可用 onType('error', ...) 订阅。
    this.on('error', () => {});
  }

  /** 广播一个结构化 agent 事件（泛型 + typed 双 channel）。 */
  emitEvent(event: AgentStreamEvent): boolean {
    // 泛型 channel：传输层/可观测层统一入口
    this.emit('event', event);
    // typed channel：细粒度监听器（如仅关心 'text'）
    this.emit(event.type, event as any);
    return true;
  }

  /** 订阅全部事件（推荐用于 SSE 等传输层）。 */
  onEvent(handler: (event: AgentStreamEvent) => void): this {
    return this.on('event', handler as any);
  }

  /** 订阅指定 type 的事件。 */
  onType<T extends AgentStreamEvent['type']>(
    type: T,
    handler: (event: Extract<AgentStreamEvent, { type: T }>) => void
  ): this {
    return this.on(type, handler as any);
  }
}
