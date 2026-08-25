// ============================================================
// Session Log — the authoritative, append-only event stream.
//
// Principle (from DeepSeek Harness): anything the model sees must
// be reconstructable from the log. UI, replay, resume, telemetry
// and future evaluation all derive from this single source instead
// of each keeping "mostly right" state.
//
// Event types:
//   turn_start        a new user turn begins (turn_idx++)
//   user_message      the user's input for this turn
//   steer             a user message injected mid-turn (steering)
//   context_injected  system prompt / memories / skills / KB injected
//   model_call        one model request (step_idx, model, tokens)
//   text              assistant text output
//   tool_call         a tool invocation (name + args)
//   tool_result       its result (output + duration)
//   approval_pending  tool waiting for user approval
//   approval_resolved approve / deny / timeout
//   complete          turn finished
//   error             anything went wrong
// ============================================================

import { getDb, withDbRetry } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

export type SessionEventType =
  | 'turn_start'
  | 'user_message'
  | 'steer'
  | 'context_injected'
  | 'model_call'
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'approval_pending'
  | 'approval_resolved'
  | 'complete'
  | 'error'
  | 'reflection' // 幻觉工具名反思注入 / 子 Agent 错误堆栈
  | 'backoff'    // 指数退避等待事件
  | 'workflow_step' // StateGraph 节点跳转
  | 'workflow_complete' // 工作流结束
  | 'context_compressed'; // 自适应上下文压缩触发

export interface SessionEvent {
  id: string;
  sessionId: string;
  seq: number;
  turnIdx: number;
  stepIdx: number;
  type: SessionEventType;
  role?: string;
  content?: string;
  toolName?: string;
  args?: string;
  result?: string;
  model?: string;
  tokens?: string;
  createdAt: string;
}

export interface EventInput {
  sessionId: string;
  turnIdx?: number;
  stepIdx?: number;
  type: SessionEventType;
  role?: string;
  content?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  model?: string;
  tokens?: unknown;
}

export type SessionEventRow = {
  id: string;
  session_id: string;
  seq: number;
  turn_idx: number;
  step_idx: number;
  type: SessionEventType;
  role?: string;
  content?: string;
  tool_name?: string;
  args?: string;
  result?: string;
  model?: string;
  tokens?: string;
  created_at: string;
};

class SessionEventStore {
  private appendCount = 0;

  /** 定期清理过期事件（默认保留 30 天），防止长期会话磁盘无限膨胀。 */
  purgeExpired(days = 30): void {
    try {
      getDb()
        .prepare(`DELETE FROM session_events WHERE created_at < datetime('now', ?)`)
        .run(`-${days} days`);
    } catch {
      /* purge is best-effort */
    }
  }

  /** Append an event; seq is auto-assigned per session (1-based). */
  async append(input: EventInput): Promise<SessionEvent> {
    // 每 300 次写入清理一次过期事件（廉价、分摊到写路径）
    if (++this.appendCount % 300 === 0) this.purgeExpired();
    const db = getDb();
    const row = db
      .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM session_events WHERE session_id = ?`)
      .get(input.sessionId) as { next: number };
    const seq = row.next;
    const id = uuidv4();
    await withDbRetry(() =>
      db.prepare(
        `INSERT INTO session_events (id, session_id, seq, turn_idx, step_idx, type, role, content, tool_name, args, result, model, tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.sessionId,
        seq,
        input.turnIdx ?? 0,
        input.stepIdx ?? 0,
        input.type,
        input.role ?? null,
        input.content ?? null,
        input.toolName ?? null,
        input.args !== undefined ? JSON.stringify(input.args) : null,
        input.result !== undefined ? JSON.stringify(input.result) : null,
        input.model ?? null,
        input.tokens !== undefined ? JSON.stringify(input.tokens) : null
      )
    );
    return {
      id,
      sessionId: input.sessionId,
      seq,
      turnIdx: input.turnIdx ?? 0,
      stepIdx: input.stepIdx ?? 0,
      type: input.type,
      role: input.role,
      content: input.content,
      toolName: input.toolName,
      args: input.args !== undefined ? JSON.stringify(input.args) : undefined,
      result: input.result !== undefined ? JSON.stringify(input.result) : undefined,
      model: input.model,
      tokens: input.tokens !== undefined ? JSON.stringify(input.tokens) : undefined,
      createdAt: new Date().toISOString(),
    };
  }

  /** All events for a session, oldest first. */
  list(sessionId: string): SessionEvent[] {
    const rows = getDb()
      .prepare(`SELECT * FROM session_events WHERE session_id = ? ORDER BY seq ASC`)
      .all(sessionId) as SessionEventRow[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      seq: r.seq,
      turnIdx: r.turn_idx,
      stepIdx: r.step_idx,
      type: r.type,
      role: r.role,
      content: r.content,
      toolName: r.tool_name,
      args: r.args,
      result: r.result,
      model: r.model,
      tokens: r.tokens,
      createdAt: r.created_at,
    }));
  }

  /** Pending steering messages: user messages with turn_idx = 0 that were injected mid-run. */
  countByType(sessionId: string, type: SessionEventType): number {
    const r = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM session_events WHERE session_id = ? AND type = ?`)
      .get(sessionId, type) as { n: number };
    return r.n;
  }
}

export const sessionEvents = new SessionEventStore();
