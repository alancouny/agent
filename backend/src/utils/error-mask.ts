/* eslint-disable @typescript-eslint/no-explicit-any */
export function safeErrorMessage(err: unknown): string {
  const e = err as any;
  const raw = typeof e?.message === 'string' ? e.message : String(err);
  // 移除潜在敏感信息：API Key、Token、B secret、Bearer token
  return raw
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_.-]{8,}/gi, '$1=***')
    // OpenAI 标准错误格式："Incorrect API key provided: sk-xxx"（key 与值之间带空格，
    // 且 sk- 短值 < 32 字符时上一条与长串规则都不命中）。白名单原则：仅 sk- 前缀触发，
    // 值取 8~40 字符（真实 key 为 sk- + 48 位，会被下方 {32,} 长串规则兜住）。
    .replace(/\bsk-[a-z0-9_-]{8,40}\b/gi, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9_-]{20,}/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{32,}/g, (m: string) => m.length > 32 ? m.slice(0,8)+'***' : m);
}

export function logError(logger: {error: (msg: string, ...a: any[])=>void}, ctx: string, err: unknown) {
  const msg = safeErrorMessage(err);
  logger.error(`[${ctx}] ${msg}`);
}
