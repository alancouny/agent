// ============================================================
// 全局长期记忆 — 类型与 Provider 接口。
// 双来源架构：内置 local（SQLite）+ MCP 第三方笔记（Obsidian/Notion…）。
// 详见 docs/MEMORY_ARCH.md。
// ============================================================

export interface MemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  /** 来源标识（local / mcp:xxx / agent 写入） */
  source: string;
  createdAt: string;
  updatedAt: string;
  /** 检索评分（仅 search 结果带） */
  score?: number;
}

export interface MemoryProvider {
  readonly id: string;
  readonly kind: 'local' | 'mcp';
  readonly label: string;
  isAvailable(): Promise<boolean>;
  list(limit?: number): Promise<MemoryEntry[]>;
  get(id: string): Promise<MemoryEntry | null>;
  add(entry: { content: string; tags?: string[] }): Promise<MemoryEntry>;
  update(id: string, patch: { content?: string; tags?: string[] }): Promise<MemoryEntry | null>;
  remove(id: string): Promise<boolean>;
  search(query: string, topK: number): Promise<MemoryEntry[]>;
}

/** 检索合并后的统一条目（带来源 provider）。 */
export interface RankedMemory extends MemoryEntry {
  providerId: string;
}
