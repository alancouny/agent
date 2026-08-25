import { getDb } from '../db/database.js';
import { settingsStore } from '../db/settings.js';
import { v4 as uuidv4 } from 'uuid';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required: string[];
  };
}

export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

export interface ToolContext {
  sessionId: string;
  userId?: string;
  onProgress?: (msg: string) => void;
  approvalToken?: string;
  /** Present when a tool is executed from inside an agent turn (used by delegate_task). */
  agentConfig?: {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  /** 触发本工具执行的 LLM 调用 id（瀑布图依赖链：delegate 子调用以此作为 parentId）。 */
  llmCallId?: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
  category: string;
  requiresApproval: boolean;
  enabled: boolean;
  /** True = safe to run in parallel with other read-only tools (never mutates state). */
  readOnly?: boolean;
  /**
   * 危险工具（文件写/shell 执行类）：全局审批关闭时也不可豁免。
   * 仅 MCP 注册路径写入（mcp/manager.ts），内置工具不打标（AC-R5-4）。
   */
  dangerous?: boolean;
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(name: string, def: ToolDefinition): void {
    this.tools.set(name, def);
    try {
      const db = getDb();
      // UPSERT：name 唯一冲突时更新描述/分类/enabled，避免旧行（如已下线工具的
      // enabled=1 脏数据）在重启后残留过期状态。
      db.prepare(`INSERT INTO tools (id, name, description, category, enabled) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          category = excluded.category,
          enabled = excluded.enabled`)
        .run(uuidv4(), name, def.schema.description, def.category, def.enabled ? 1 : 0);
    } catch { /* best-effort DB insert */ }
  }

  unregister(name: string): boolean {
    const existed = this.tools.delete(name);
    if (existed) {
      try {
        const db = getDb();
        db.prepare(`DELETE FROM tools WHERE name = ?`).run(name);
      } catch { /* best-effort delete */ }
    }
    return existed;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): [string, ToolDefinition][] {
    return Array.from(this.tools.entries());
  }

  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values())
      .filter(t => t.enabled)
      .map(t => t.schema);
  }

  getByCategory(category: string): [string, ToolDefinition][] {
    return this.getAll().filter(([, t]) => t.category === category);
  }
}

export const toolRegistry = new ToolRegistry();

function canonicalJson(obj: unknown): string {
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  if (obj && typeof obj === 'object') {
    return '{' + Object.keys(obj as Record<string, unknown>).sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
      .join(',') + '}';
  }
  return JSON.stringify(obj);
}

// In-memory approval store: approvalKey → token
const toolApprovalMap = new Map<string, string>();

// Global approval toggle: when false, non-dangerous tools run without approval.
// R4：持久化到 app_settings['approval.required']（settingsStore），重启后保留（AC-R4-4）。
let approvalRequired = settingsStore.get('approval.required', true);

export function getToolApprovals(): Map<string, string> {
  return toolApprovalMap;
}

/** 写入审批条目并挂 TTL（默认 10 分钟自动清理，防断连/未审批的 key 无限驻留内存）。 */
export function setApprovalWithTTL(key: string, token: string, ttlMs = 10 * 60 * 1000): void {
  toolApprovalMap.set(key, token);
  const timer = setTimeout(() => {
    if (toolApprovalMap.get(key) === token) toolApprovalMap.delete(key);
  }, ttlMs);
  if (typeof timer.unref === 'function') timer.unref();
}

export function isApprovalRequired(): boolean {
  return approvalRequired;
}

export function setApprovalRequired(value: boolean): void {
  approvalRequired = value;
  // 即时落库：重启后从 app_settings 加载（AC-R4-4）
  settingsStore.set('approval.required', value);
}

/**
 * 审批开关变更审计（event_type='approval_toggle'，复用 audit_logs 表）。
 * input   = { enabled, confirm, actor }
 * output  = { from, to, result, reason }
 * 成功与失败尝试都记录（失败 result='rejected'）。
 */
export function logApprovalToggle(
  prev: boolean,
  next: boolean,
  actor: string,
  result: 'ok' | 'rejected',
  note: string | null = null,
  confirm: boolean | null = null
): void {
  try {
    const db = getDb();
    db.prepare(`INSERT INTO audit_logs (id, session_id, event_type, tool_name, input, output, permission, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        uuidv4(),
        null,
        'approval_toggle',
        null,
        JSON.stringify({ enabled: next, confirm, actor }),
        JSON.stringify({ from: prev, to: next, result, reason: note }),
        null,
        null
      );
  } catch { /* best-effort audit log write */ }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { success: false, output: `Tool '${name}' not found`, error: 'TOOL_NOT_FOUND' };
  }
  if (!tool.enabled) {
    return { success: false, output: `Tool '${name}' is disabled`, error: 'TOOL_DISABLED' };
  }

  // Approval gate（两层判定，R5）：
  //   1) 全局开关 approvalRequired=true → 所有 requiresApproval 工具需审批；
  //   2) 危险工具（dangerous===true，仅 MCP 注册路径打标）即使全局关闭也强制审批（AC-R5-3）。
  // 非危险 MCP / 内置工具在全局关闭时按原逻辑豁免（AC-R5-4）。
  const mustApprove = approvalRequired || tool.dangerous === true;
  if (tool.requiresApproval && mustApprove) {
    const approvalKey = `approval:${context.sessionId}:${name}:${canonicalJson(args)}`;
    const approved = context.approvalToken && toolApprovalMap.get(approvalKey) === context.approvalToken;
    if (!approved) {
      return {
        success: false,
        output: `Tool '${name}' requires user approval. Call POST /api/agent/tools/approve to approve or deny.`,
        error: 'PENDING_APPROVAL',
        data: {
          toolName: name,
          args,
          category: tool.category,
          approvalKey,
        },
      };
    }
  }

  const start = Date.now();
  try {
    const result = await tool.handler(args, context);
    const duration = Date.now() - start;
    logAudit(context.sessionId, name, args, result, duration, 'allow');
    return result;
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const safeMsg = (err instanceof Error)
      ? `An error occurred in ${name}: ${err.message.replace(/\/[^\s]+/g, '[path]')}`
      : `An error occurred in ${name}`;
    const errorResult: ToolResult = { success: false, output: safeMsg, error: safeMsg };
    logAudit(context.sessionId, name, args, errorResult, duration, 'deny');
    return errorResult;
  }
}

function logAudit(
  sessionId: string,
  toolName: string,
  input: unknown,
  output: ToolResult,
  durationMs: number,
  permission: string
): void {
  try {
    const db = getDb();
    db.prepare(`INSERT INTO audit_logs (id, session_id, event_type, tool_name, input, output, permission, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), sessionId, 'tool_call', toolName, JSON.stringify(input), JSON.stringify(output), permission, durationMs);
  } catch { /* best-effort audit log write */ }
}