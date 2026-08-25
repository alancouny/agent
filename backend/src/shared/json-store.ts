// ============================================================
// Shared JSON file store helpers — 原子写 + 安全读。
// 直接 writeFileSync 在进程崩溃/中断时会损坏配置；
// 原子写（temp + rename）保证任意时刻磁盘上要么是旧文件、要么是新文件。
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../utils/logger.js';

/** 原子写 JSON：先写同目录临时文件再 rename，避免崩溃损坏。 */
export function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

/** 安全读 JSON：解析失败返回 undefined 并打印告警（不静默吞掉，避免"数据丢失"假象）。 */
export function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[json-store] failed to parse ${file}:`, msg);
    return undefined;
  }
}

export function ensureDir(file: string): void {
  const dir = dirname(file);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}
