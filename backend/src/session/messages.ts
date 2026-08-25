// ============================================================
// Shared message persistence — 会话创建 / 用户消息 / 助手消息落库的单一实现。
// /chat 与 /workflow/run 共用，避免两份逻辑漂移。
// ============================================================

import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentMessage } from '../agent/types.js';

/** 确保会话存在（客户端可能直接给一个未持久化的 sessionId）。 */
export function ensureSession(sessionId: string, title: string, model?: string, provider?: string): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
  if (!existing) {
    db.prepare(`INSERT INTO sessions (id, title, model, provider) VALUES (?, ?, ?, ?)`)
      .run(sessionId, title.substring(0, 50), model || 'gpt-4o', provider || 'openai');
  }
}

export function saveUserMessage(sessionId: string, content: string): void {
  getDb()
    .prepare(`INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)`)
    .run(uuidv4(), sessionId, content);
}

/** 保存助手消息；带 tool_calls 元数据以便 resume 时精确重建模型输入。 */
export function saveAssistantMessage(
  sessionId: string,
  content: string,
  toolCalls?: AgentMessage['tool_calls']
): void {
  if (!content) return;
  getDb()
    .prepare(
      `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, name) VALUES (?, ?, 'assistant', ?, ?, NULL, NULL)`
    )
    .run(uuidv4(), sessionId, content, toolCalls ? JSON.stringify(toolCalls) : null);
}

/** 从 messages 表重建会话历史（Harness: resume 从事件日志派生）。 */
export function loadMessages(sessionId: string): AgentMessage[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT role, content, tool_calls, tool_call_id, name FROM messages WHERE session_id = ? AND role != 'system' ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId) as { role: string; content: string; tool_calls: string | null; tool_call_id: string | null; name: string | null }[];
  const out: AgentMessage[] = [];
  for (const r of rows) {
    let tool_calls: AgentMessage['tool_calls'];
    if (r.tool_calls) {
      try {
        tool_calls = typeof r.tool_calls === 'string' ? JSON.parse(r.tool_calls) : r.tool_calls;
      } catch {
        tool_calls = undefined;
      }
    }
    out.push({
      role: r.role as AgentMessage['role'],
      content: r.content || '',
      tool_calls,
      tool_call_id: r.tool_call_id || undefined,
      name: r.name || undefined,
    });
  }
  return out;
}
