import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { runWithRequest, getRequestId, requestIdMiddleware } from '../src/utils/request-context.js';
import { logger } from '../src/utils/logger.js';
import { app as serverApp, errorHandler } from '../src/server.js';

let server: any;
let base: string;

test.before(async () => {
  // 直接使用真实 server app（requestId → limiter → auth → routes → errorHandler 全链路）
  await new Promise<void>((resolve) => {
    server = serverApp.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

// ── AsyncLocalStorage 基础语义 ──
test('request-context: runWithRequest/getRequestId propagate and restore context', () => {
  assert.equal(getRequestId(), undefined, 'no context outside runWithRequest');
  runWithRequest('req-outer', () => {
    assert.equal(getRequestId(), 'req-outer');
    runWithRequest('req-inner', () => {
      assert.equal(getRequestId(), 'req-inner');
    });
    assert.equal(getRequestId(), 'req-outer', 'inner run restores outer context');
  });
  assert.equal(getRequestId(), undefined, 'context cleared after runWithRequest');
});

// ── 免鉴权路由（健康检查）也有 requestId ──
test('request-context: health check (skip-auth) returns X-Request-Id header', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const rid = res.headers.get('x-request-id');
  assert.ok(rid && rid.length > 0, 'X-Request-Id present on skip-auth route');
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

// ── 日志行带 rid：同一请求的 req/res 日志包含响应头里的同一个 requestId ──
test('request-context: request logs carry the same rid as X-Request-Id header', async () => {
  const captured: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  try {
    const res = await fetch(`${base}/health`);
    const rid = res.headers.get('x-request-id')!;
    await res.text();
    // finish 回调是异步触发，稍等一拍再断言
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(
      captured.some((line) => line.includes(`rid=${rid}`)),
      `captured logs include rid=${rid}\n---\n${captured.join('\n')}`
    );
    assert.ok(captured.some((line) => line.includes('req GET /api/health')), 'entry log present');
    assert.ok(captured.some((line) => line.includes('res GET /api/health 200')), 'exit log with status present');
  } finally {
    console.log = origLog;
    console.error = origError;
  }
});

// ── 受保护路由无鉴权 → 401，且 401 也带 X-Request-Id ──
test('request-context: unauthenticated protected route returns 401 with X-Request-Id', async () => {
  const res = await fetch(`${base}/sessions`);
  assert.equal(res.status, 401);
  const rid = res.headers.get('x-request-id');
  assert.ok(rid && rid.length > 0, 'X-Request-Id present on 401 response');
  const body = await res.json();
  assert.equal(body.error, 'Unauthorized: missing or invalid API key');
});

// ── 错误响应脱敏（api_key / Bearer / 32+ 位密钥）──
function buildThrowingApp() {
  const mini = express();
  mini.use(requestIdMiddleware);
  mini.get('/boom', (_req, _res, next) => {
    next(
      new Error(
        'boom api_key=sk-abcdef1234567890abcdef ' +
          'Bearer abcdefghijklmnopqrstuvwxyz1234567890 ' +
          'secret12345678901234567890123456789012'
      )
    );
  });
  mini.use(errorHandler);
  return mini;
}

test('request-context: error responses are sanitized via safeErrorMessage', async () => {
  const mini = buildThrowingApp();
  const srv = await new Promise<any>((resolve) => {
    const s = mini.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/boom`);
    assert.equal(res.status, 500);
    const rid = res.headers.get('x-request-id');
    assert.ok(rid && rid.length > 0, 'X-Request-Id present on error response');
    const body = await res.json();
    assert.ok(body.error.includes('api_key=***'), 'api_key masked');
    assert.ok(!body.error.includes('sk-abcdef1234567890abcdef'), 'raw api_key not leaked');
    assert.ok(body.error.includes('Bearer ***'), 'Bearer token masked');
    assert.ok(!body.error.includes('Bearer abcdefghijklmnopqrstuvwxyz'), 'raw Bearer token not leaked');
    assert.ok(!body.error.includes('secret12345678901234567890123456789012'), 'long secret not leaked');
  } finally {
    srv.close();
  }
});

// ── logger 上下文集成：路由内 logger 自动带 rid ──
test('request-context: logger inside a route carries the request rid', async () => {
  const mini = express();
  mini.use(requestIdMiddleware);
  mini.get('/log', (_req, res) => {
    logger.info('inside-route-log');
    res.json({ ok: true });
  });
  mini.use(errorHandler);
  const srv = await new Promise<any>((resolve) => {
    const s = mini.listen(0, () => resolve(s));
  });
  const captured: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/log`);
    const rid = res.headers.get('x-request-id')!;
    await res.text();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(
      captured.some((line) => line.includes('inside-route-log') && line.includes(`rid=${rid}`)),
      `route logger line carries rid\n---\n${captured.join('\n')}`
    );
  } finally {
    console.log = origLog;
    console.error = origError;
    srv.close();
  }
});
