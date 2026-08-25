// ============================================================
// requestId 请求上下文（决策 D：AsyncLocalStorage，业务代码无感）。
//
// 每个 HTTP 请求进入时由 requestIdMiddleware 生成 UUID 并注入 ALS，
// 同请求内的所有 logger.* 调用自动携带该 id；业务代码需要时用
// getRequestId() 读取，不需要显式传参。
// ============================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';

/** 每请求 requestId 的 AsyncLocalStorage（Node v22 原生支持）。 */
const requestStorage = new AsyncLocalStorage<string>();

/** 在指定 requestId 上下文中执行 fn；上下文中所有 logger.* 调用自动携带该 id。 */
export function runWithRequest<T>(requestId: string, fn: () => T): T {
  return requestStorage.run(requestId, fn);
}

/** 读取当前请求的 requestId；无请求上下文（非 HTTP 场景）时返回 undefined。 */
export function getRequestId(): string | undefined {
  return requestStorage.getStore();
}

/**
 * 入口 requestId 中间件：生成 UUID → 注入 ALS → 写 X-Request-Id 响应头。
 *
 * 必须挂在所有中间件/路由之前（rateLimit 之前），健康检查等免鉴权路由
 * 同样覆盖，保证 401/429/500 等所有响应都带 X-Request-Id。
 * 可选记录入口/出口请求日志（LOG_REQUESTS 控制，见 requestLoggingEnabled）。
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const startHr = process.hrtime.bigint();
  runWithRequest(requestId, () => {
    if (requestLoggingEnabled()) {
      logger.info(`req ${req.method} ${req.originalUrl || req.url}`);
    }
    // finish 回调运行在独立的异步上下文，需重新包一层 ALS 才能让 logger 自动带 rid
    res.on('finish', () => {
      runWithRequest(requestId, () => {
        if (!requestLoggingEnabled()) return;
        const durMs = Number(process.hrtime.bigint() - startHr) / 1e6;
        logger.info(`res ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${durMs.toFixed(1)}ms`);
      });
    });
    next();
  });
}

/**
 * 入口/出口请求日志开关：显式 LOG_REQUESTS=1/0 优先；
 * 未设置时 LOG_LEVEL=info（默认级别）开启请求日志。
 */
function requestLoggingEnabled(): boolean {
  const v = process.env.LOG_REQUESTS?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return (process.env.LOG_LEVEL ?? 'info').trim().toLowerCase() === 'info';
}
