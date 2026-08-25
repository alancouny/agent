// ============================================================
// GlobalState (Shared Blackboard)
//
// 所有 Agent 实例可读写的全局共享状态，用于跨 Agent 传递数据。
// 典型用途：
//   - Agent A 调用数据库后提取连接信息，Agent B 复用该连接
//   - 用户原始目标（grounding objective）在整个多 Agent 协作中保持可见
//   - 验收标准（acceptance criteria）跨子 Agent 共享
//
// 使用方式：
//   import { blackboard } from '../shared/blackboard.js';
//   blackboard.set('db_url', 'postgres://...');
//   const url = blackboard.get('db_url');
//   blackboard.setObjective('Extract user preferences from conversation');
// ============================================================

export interface BlackboardEntry {
  key: string;
  value: unknown;
  owner: string; // sessionId or 'system'
  writtenAt: number;
}

export class Blackboard {
  private store: Map<string, BlackboardEntry> = new Map();

  /** 写入共享变量（任何 Agent 均可覆盖）。 */
  set(key: string, value: unknown, owner: string): void {
    this.store.set(key, { key, value, owner, writtenAt: Date.now() });
  }

  /** 读取共享变量，不存在返回 undefined。 */
  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  /** 批量写入（常用于 sub-agent 初始化时注入父 agent 的结果）。 */
  batch(entries: Array<{ key: string; value: unknown; owner: string }>): void {
    for (const e of entries) this.set(e.key, e.value, e.owner);
  }

  /** 读取全部条目（供 Supervisor Agent 收集子 Agent 产出）。 */
  getAll(): BlackboardEntry[] {
    return Array.from(this.store.values());
  }

  /** 清除某 key（如子 Agent 完成任务后清理临时变量）。 */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** 清除全部（新会话开始时重置）。 */
  clear(): void {
    this.store.clear();
  }
}

/** 全局唯一实例（单例）。 */
export const blackboard = new Blackboard();
