// ============================================================
// LLM call tracer — 记录所有层级 LLM 调用的先后顺序与依赖关系。
//
// 全局环形缓冲（防泄漏），AgentCore / delegate / workflow 埋点；
// 前端瀑布图经 GET /api/telemetry/llm-calls 拉取。
// 详见 docs/MEMORY_ARCH.md（LLM 调用追踪一节）。
// ============================================================

import { randomUUID } from 'node:crypto';

export type AgentKind = 'main' | 'delegate' | 'supervisor' | 'worker';

export interface LLMCallRecord {
  id: string;
  sessionId: string;
  agentKind: AgentKind;
  parentId: string | null;
  model: string;
  startAt: number;
  endAt: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turn: number;
  step: number;
  toolNames: string[];
  failed: boolean;
  contentPreview: string;
}

export interface BeginInput {
  sessionId: string;
  agentKind: AgentKind;
  parentId: string | null;
  model: string;
  turn: number;
  step: number;
}

export interface EndInput {
  promptTokens?: number;
  completionTokens?: number;
  toolNames?: string[];
  failed?: boolean;
  contentPreview?: string;
}

const CAPACITY = 1000;

class LLMTracer {
  private records: LLMCallRecord[] = [];
  private byId = new Map<string, number>(); // id → index in records

  /** 开始一次 LLM 调用，返回 record id（供 end 使用）。 */
  begin(input: BeginInput): string {
    const id = randomUUID();
    const rec: LLMCallRecord = {
      id,
      sessionId: input.sessionId,
      agentKind: input.agentKind,
      parentId: input.parentId,
      model: input.model,
      startAt: Date.now(),
      endAt: 0,
      durationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      turn: input.turn,
      step: input.step,
      toolNames: [],
      failed: false,
      contentPreview: '',
    };
    this.records.push(rec);
    this.byId.set(id, this.records.length - 1);
    if (this.records.length > CAPACITY) {
      const dropped = this.records.splice(0, this.records.length - CAPACITY);
      for (const d of dropped) this.byId.delete(d.id);
      // 重建索引（偏移变化）
      this.byId.clear();
      this.records.forEach((r, i) => this.byId.set(r.id, i));
    }
    return id;
  }

  /** 结束一次 LLM 调用并补全统计。 */
  end(id: string, patch: EndInput = {}): void {
    const idx = this.byId.get(id);
    if (idx === undefined) return;
    const rec = this.records[idx];
    rec.endAt = Date.now();
    rec.durationMs = rec.endAt - rec.startAt;
    rec.promptTokens = patch.promptTokens ?? 0;
    rec.completionTokens = patch.completionTokens ?? 0;
    rec.totalTokens = rec.promptTokens + rec.completionTokens;
    if (patch.toolNames) rec.toolNames = patch.toolNames;
    rec.failed = patch.failed ?? false;
    if (patch.contentPreview) rec.contentPreview = patch.contentPreview.slice(0, 120);
  }

  /** 按会话拉取（可选按时间倒序截断）。 */
  list(sessionId?: string, limit = 200): LLMCallRecord[] {
    const filtered = sessionId
      ? this.records.filter((r) => r.sessionId === sessionId)
      : [...this.records];
    return filtered.slice(-limit);
  }

  clear(sessionId?: string): void {
    if (!sessionId) {
      this.records = [];
      this.byId.clear();
      return;
    }
    this.records = this.records.filter((r) => r.sessionId !== sessionId);
    this.byId.clear();
    this.records.forEach((r, i) => this.byId.set(r.id, i));
  }
}

export const llmTracer = new LLMTracer();
