// ============================================================
// 应用级键值设置（app_settings 表）——R4 决策 E：与现有 DB 一致，不引入 JSON 配置。
//
// 统一经 settingsStore 读写（内存缓存 + 即时落库），value 一律 JSON 序列化；
// 禁止在其它文件直接 SQL 读写 app_settings。
// ============================================================

import { getDb } from './database.js';

interface AppSettingsRow {
  key: string;
  value: string;
}

class SettingsStore {
  private cache = new Map<string, string>();

  /** 读取设置；无记录或解析失败时返回 fallback。 */
  get<T>(key: string, fallback: T): T {
    const cached = this.cache.get(key);
    const raw = cached !== undefined ? cached : this.readFromDb(key);
    if (raw === undefined) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 脏值（非 JSON）时回退，避免把错误类型抛给调用方
      return fallback;
    }
  }

  /** 写入设置：JSON 序列化后即时落库（UPSERT），并同步内存缓存。 */
  set<T>(key: string, value: T): void {
    const json = JSON.stringify(value);
    getDb()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      )
      .run(key, json);
    this.cache.set(key, json);
  }

  private readFromDb(key: string): string | undefined {
    const row = getDb()
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(key) as AppSettingsRow | undefined;
    if (!row) return undefined;
    this.cache.set(key, row.value);
    return row.value;
  }
}

export const settingsStore = new SettingsStore();
