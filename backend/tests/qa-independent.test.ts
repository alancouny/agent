// ============================================================
// QA 独立验证（第一轮）—— 不依赖工程师既有用例的安全断言验证。
//
// 覆盖：
//   R3: requestId 链路贯穿 + 错误脱敏（统一 errorHandler 与路由级错误响应）
//   R4: 审批开关 401/400/200 + 审计留痕
//   R5: MCP 白名单 fail-closed + 危险工具不可豁免 + 判定边界
//   R2: FTS5 预筛 + 中英混合 + TTL 缓存 + 空/特殊字符边界
//
// 命名约定：通过用例 = 验证 AC 成立；`QA-BUG-*` = 断言正确行为，
// 若失败即证明源码缺陷（记录于 QA_MEDIUM_TIER_BACKEND.md，不修源码）。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { app as serverApp, ensureApiKey, errorHandler } from '../src/server.js';
import { requestIdMiddleware } from '../src/utils/request-context.js';
import { safeErrorMessage } from '../src/utils/error-mask.js';
import { getDb } from '../src/db/database.js';
import {
  toolRegistry,
  executeTool,
  isApprovalRequired,
  setApprovalRequired,
} from '../src/tools/registry.js';
import { isDangerousToolName, classifyDanger } from '../src/tools/dangerous.js';
import { mcpManager } from '../src/mcp/manager.js';
import { mcpStore, type McpServerConfig } from '../src/mcp/store.js';
import { localMemoryProvider } from '../src/memory/local.js';
import {
  searchCandidateIds,
  getCachedSearch,
  putCachedSearch,
  CACHE_TTL_MS,
  invalidateMemoryCache,
} from '../src/memory/fts.js';
import { agentRouter } from '../src/routes/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'src', 'mcp', 'fixtures', 'echo-server.mjs');
const DANGEROUS_FIXTURE = path.join(__dirname, '..', 'src', 'mcp', 'fixtures', 'dangerous-server.mjs');

// mcp_servers.json 隔离：备份/恢复真实配置（沿用 mcp.test.ts 模式）
const STORE_FILE = path.join(__dirname, '..', 'data', 'mcp_servers.json');
let storeBackup: string | null = null;

let server: any;
let base: string;
let key: string;

test.before(async () => {
  key = ensureApiKey();
  await new Promise<void>((resolve) => {
    server = serverApp.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;

  if (fs.existsSync(STORE_FILE)) storeBackup = fs.readFileSync(STORE_FILE, 'utf-8');
  // 清空记忆，保证本文件 R2 用例隔离
  getDb().prepare('DELETE FROM global_memories').run();
  invalidateMemoryCache();
  // 复位审批开关为默认 true，避免前序进程/模块残留影响
  setApprovalRequired(true);
});

test.after(async () => {
  server?.close();
  if (storeBackup !== null) fs.writeFileSync(STORE_FILE, storeBackup);
  else if (fs.existsSync(STORE_FILE)) fs.rmSync(STORE_FILE, { force: true });
});

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extra };
}

function auditRows(): { input: string; output: string; created_at: string }[] {
  const db = getDb();
  return db
    .prepare(`SELECT input, output, created_at FROM audit_logs WHERE event_type = 'approval_toggle' ORDER BY created_at, rowid`)
    .all() as { input: string; output: string; created_at: string }[];
}

// ───────────────────────── R3：requestId 链路 + 脱敏 ─────────────────────────

test('QA-R3-1: same requestId across auth-rejected response and all logs (AC-R3-1)', async () => {
  const captured: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  try {
    // 无鉴权 → 401（auth 中间件拒绝），响应头 X-Request-Id 存在
    const res = await fetch(`${base}/agent/settings/approval`);
    assert.equal(res.status, 401);
    const rid = res.headers.get('x-request-id');
    assert.ok(rid && rid.length > 0, 'X-Request-Id on 401');
    await res.text();
    await new Promise((r) => setTimeout(r, 40));
    // 同一请求所有带 rid 的日志行必须是同一个 requestId
    const ridLines = captured.filter((l) => l.includes('rid='));
    assert.ok(ridLines.length > 0, 'captured logs carry rid');
    for (const line of ridLines) {
      const m = line.match(/rid=([0-9a-f-]{36})/);
      assert.ok(m, `rid format in: ${line}`);
      assert.equal(m[1], rid, `log rid matches header rid\n  log: ${line}`);
    }
  } finally {
    console.log = origLog;
    console.error = origError;
  }
});

test('QA-R3-2: unified errorHandler sanitizes api_key/Bearer/long-secret (AC-R3-2)', async () => {
  const mini = express();
  mini.use(requestIdMiddleware);
  mini.get('/boom', (_req, _res, next) => {
    next(new Error(
      'boom api_key=sk-mysecret1234567890abcdef token=abcdefghijklmnopqrstuvwxyz123456 ' +
      'Bearer xyzabcdefghijklmnopqrstuvwxyz123456'
    ));
  });
  mini.use(errorHandler);
  const srv = await new Promise<any>((resolve) => {
    const s = mini.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/boom`);
    assert.equal(res.status, 500);
    assert.ok(res.headers.get('x-request-id'), 'X-Request-Id on error response');
    const body = await res.json();
    assert.ok(!body.error.includes('sk-mysecret1234567890abcdef'), 'api_key value not leaked');
    assert.ok(!body.error.includes('xyzabcdefghijklmnopqrstuvwxyz123456'), 'bearer not leaked');
    assert.ok(!body.error.includes('abcdefghijklmnopqrstuvwxyz123456'), 'long secret not leaked');
  } finally {
    srv.close();
  }
});

test('QA-R3-2-BUG: route-level error responses (/agent/test-openai) leak raw api_key (AC-R3-2 gap)', async () => {
  // 上游 mock：返回含 api_key=sk-xxx 的错误体（OpenAI SDK 会原样透传 err.message）
  const upstream = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid api_key=sk-abcdef1234567890abcdef supplied' } }));
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  const port = (upstream.address() as any).port;

  // 不带 auth 的 mini app 直达 agentRouter（等价于 core-routes.test.ts 的挂载方式）
  const mini = express();
  mini.use(express.json());
  mini.use('/api/agent', agentRouter);
  const srv = await new Promise<any>((resolve) => {
    const s = mini.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/agent/test-openai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-abcdef1234567890abcdef', model: 'gpt-4o' }),
    });
    const body = await res.json();
    // 预期（AC-R3-2）：错误响应不出现明文密钥；实际路由未脱敏 → 断言失败即缺陷
    assert.ok(
      !body.message || !body.message.includes('sk-abcdef1234567890abcdef'),
      `route-level error response must not leak raw key, got: ${JSON.stringify(body.message)}`
    );
  } finally {
    srv.close();
    upstream.close();
  }
});

test('QA-R3-2-EDGE: safeErrorMessage fails to mask "API key provided: sk-xxx" (common OpenAI format)', () => {
  const raw = 'Incorrect API key provided: sk-test1234567890abcdefgh. You can find';
  const out = safeErrorMessage(raw);
  // 该格式（API key 带空格 + 短于 32 位的 sk- 值）无法被现有掩码规则捕获 → 提示加固缺口
  assert.ok(!out.includes('sk-test1234567890abcdefgh'), `safeErrorMessage should mask, got: ${out}`);
});

// ───────────────────────── R4：审批开关安全加固 ─────────────────────────

test('QA-R4-1: unauthenticated approval POST/GET → 401 and toggle unchanged (AC-R4-1)', async () => {
  const getRes = await fetch(`${base}/agent/settings/approval`);
  assert.equal(getRes.status, 401);
  const postRes = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, confirm: true }),
  });
  assert.equal(postRes.status, 401);
  const getAuth = await fetch(`${base}/agent/settings/approval`, { headers: authHeaders() });
  const body = await getAuth.json();
  assert.equal(body.approvalRequired, true, 'toggle unchanged after unauthenticated attempts');
});

test('QA-R4-2: disable without confirm → 400 unchanged; with confirm → 200; enable no confirm → 200 (AC-R4-2)', async () => {
  setApprovalRequired(true);
  const noConfirm = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: false }),
  });
  assert.equal(noConfirm.status, 400);
  const after400 = await (await fetch(`${base}/agent/settings/approval`, { headers: authHeaders() })).json();
  assert.equal(after400.approvalRequired, true, 'toggle unchanged after 400');

  const off = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: false, confirm: true }),
  });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).approvalRequired, false);

  const on = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: true }),
  });
  assert.equal(on.status, 200);
  assert.equal((await on.json()).approvalRequired, true, 'enable does not require confirm');

  // 恢复默认
  setApprovalRequired(true);
});

test('QA-R4-3: success and rejected toggle attempts are audited with approval_toggle (AC-R4-3)', async () => {
  setApprovalRequired(true);
  const before = auditRows().length;

  // rejected attempt（缺 confirm）
  const rej = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: false }),
  });
  assert.equal(rej.status, 400);
  // success disable
  const off = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: false, confirm: true }),
  });
  assert.equal(off.status, 200);
  // success enable
  const on = await fetch(`${base}/agent/settings/approval`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: true }),
  });
  assert.equal(on.status, 200);

  const rows = auditRows().slice(before);
  assert.equal(rows.length, 3, `expected 3 new audit rows (rejected+off+on), got ${rows.length}`);

  const rejRow = rows.find((r) => JSON.parse(r.output).result === 'rejected');
  assert.ok(rejRow, 'rejected row present');
  assert.equal(JSON.parse(rejRow.output).reason, 'missing confirm');

  const offRow = rows.find((r) => { const o = JSON.parse(r.output); return o.result === 'ok' && o.to === false; });
  assert.ok(offRow, 'ok:disable row present');
  assert.equal(JSON.parse(offRow.output).from, true);
  assert.equal(JSON.parse(offRow.output).to, false);
  const offIn = JSON.parse(offRow.input);
  assert.equal(offIn.confirm, true);
  assert.ok(String(offIn.actor).includes('|'), 'actor includes requestId|ip');

  const onRow = rows.find((r) => { const o = JSON.parse(r.output); return o.result === 'ok' && o.to === true; });
  assert.ok(onRow, 'ok:enable row present');
  setApprovalRequired(true);
});

// ───────────────────────── R5：MCP 白名单 + 危险工具 ─────────────────────────

function registerEcho(overrides: Partial<McpServerConfig> = {}) {
  return mcpStore.add({
    name: 'qa-echo',
    transport: 'stdio',
    command: process.execPath,
    args: FIXTURE,
    autostart: false,
    allowedTools: ['mcp__qa-echo__ping'],
    ...overrides,
  });
}

function registerDangerous(allowedTools: string[]) {
  return mcpStore.add({
    name: 'qa-danger',
    transport: 'stdio',
    command: process.execPath,
    args: DANGEROUS_FIXTURE,
    autostart: false,
    allowedTools,
  });
}

test('QA-R5-2: fail-closed — no allowedTools exposes zero tools (AC-R5-2)', async () => {
  const config = registerEcho({ name: 'qa-echo-fc', allowedTools: undefined });
  const id = config.id;
  try {
    const status = await mcpManager.connect(id);
    assert.equal(status.connected, true, status.error || 'should connect');
    assert.equal(status.tools.length, 0, 'zero tools exposed (fail-closed)');
    assert.ok(!toolRegistry.get('mcp__qa-echo-fc__ping'), 'ping NOT registered');
    const exec = await executeTool('mcp__qa-echo-fc__ping', { message: 'x' }, { sessionId: 'qa' });
    assert.equal(exec.error, 'TOOL_NOT_FOUND');
  } finally {
    await mcpManager.disconnect(id).catch(() => {});
    mcpStore.remove(id);
  }
});

test('QA-R5-3: dangerous MCP tools stay PENDING_APPROVAL when global approval off (AC-R5-3)', async () => {
  const was = isApprovalRequired();
  const config = registerDangerous([
    'mcp__qa-danger__write_file',
    'mcp__qa-danger__exec',
    'mcp__qa-danger__read_note',
  ]);
  const id = config.id;
  try {
    const status = await mcpManager.connect(id);
    assert.equal(status.connected, true, status.error || 'should connect');

    const wf = toolRegistry.get('mcp__qa-danger__write_file');
    assert.ok(wf, 'write_file registered');
    assert.equal(wf.dangerous, true, 'write_file flagged dangerous');
    const ex = toolRegistry.get('mcp__qa-danger__exec');
    assert.equal(ex?.dangerous, true, 'exec flagged dangerous');

    setApprovalRequired(false);
    const r1 = await executeTool('mcp__qa-danger__write_file', { path: '/tmp/x' }, { sessionId: 'qa' });
    assert.equal(r1.error, 'PENDING_APPROVAL', 'write_file forced approval with global off');
    const r2 = await executeTool('mcp__qa-danger__exec', { command: 'ls' }, { sessionId: 'qa' });
    assert.equal(r2.error, 'PENDING_APPROVAL', 'exec forced approval with global off');
    const r3 = await executeTool('mcp__qa-danger__read_note', { id: 'n1' }, { sessionId: 'qa' });
    assert.equal(r3.success, true, 'non-dangerous MCP tool exempt when global off');
  } finally {
    setApprovalRequired(was);
    await mcpManager.disconnect(id).catch(() => {});
    mcpStore.remove(id);
  }
});

test('QA-R5-EDGE: whitelist with underscore tool names matches exactly; out-of-list → TOOL_NOT_FOUND', async () => {
  // read_note 名字带下划线，白名单精确匹配生效；exec 不在白名单 → 不注册
  const config = registerDangerous(['mcp__qa-danger__read_note']);
  const id = config.id;
  try {
    const status = await mcpManager.connect(id);
    assert.equal(status.connected, true, status.error || 'should connect');
    assert.ok(toolRegistry.get('mcp__qa-danger__read_note'), 'underscore name registered');
    assert.ok(!toolRegistry.get('mcp__qa-danger__write_file'), 'write_file not whitelisted → not registered');
    const exec = await executeTool('mcp__qa-danger__write_file', { path: '/tmp/x' }, { sessionId: 'qa' });
    assert.equal(exec.error, 'TOOL_NOT_FOUND');
  } finally {
    await mcpManager.disconnect(id).catch(() => {});
    mcpStore.remove(id);
  }
});

test('QA-R5-EDGE: dangerous classifier boundaries', () => {
  // 误伤接受（PRD Q-R5-2）
  assert.equal(classifyDanger('save_settings'), 'file_write');
  assert.equal(classifyDanger('create_shortcut'), 'file_write');
  assert.equal(classifyDanger('run_shell'), 'shell_exec');
  assert.equal(classifyDanger('terminal_execute'), 'shell_exec');
  // 正常工具不误伤
  assert.equal(classifyDanger('read_only_tool'), null);
  assert.equal(classifyDanger('list_files'), null);
  assert.equal(classifyDanger('search_notes'), null);
  assert.equal(classifyDanger('fetch_url'), null);
  // 缺陷缺口：rmdir（目录删除 shell 命令）未被识别为危险
  assert.notEqual(classifyDanger('rmdir'), null, 'rmdir should be flagged dangerous');
});

// ───────────────────────── R2：FTS5 预筛 + TTL 缓存 ─────────────────────────

test('QA-R2-1: FTS triggers keep indexes in sync; search uses prefilter candidates', async () => {
  const db = getDb();
  const ftsCount = () => (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts').get() as any).c;
  const triCount = () => (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts_trigram').get() as any).c;
  const mainCount = () => (db.prepare('SELECT COUNT(*) AS c FROM global_memories').get() as any).c;
  const beforeMain = mainCount();
  assert.equal(ftsCount(), beforeMain, 'fts and main in sync');
  assert.equal(triCount(), beforeMain, 'trigram and main in sync');

  const e = await localMemoryProvider.add({ content: 'qa unique token foo bar', tags: ['qa'] });
  assert.equal(mainCount(), beforeMain + 1);
  assert.equal(ftsCount(), beforeMain + 1);
  assert.equal(triCount(), beforeMain + 1);

  const cands = searchCandidateIds('qa-unique-token');
  assert.ok(cands.includes(e.id), 'FTS prefilter returns the new row id');
  await localMemoryProvider.remove(e.id);
  assert.equal(mainCount(), beforeMain);
  assert.equal(ftsCount(), beforeMain);
});

test('QA-R2-2: mixed Chinese-English query keeps key hit in topK (semantic equivalence)', async () => {
  await localMemoryProvider.add({ content: '项目预算 acme quarterly plan', tags: ['finance'] });
  const hits = await localMemoryProvider.search('acme 预算', 5);
  assert.ok(hits.some((h) => h.content.includes('acme quarterly plan')), 'mixed query recalls key hit');
});

test('QA-R2-EDGE: empty / special-char / FTS-syntax queries do not crash and return []', async () => {
  assert.deepEqual(await localMemoryProvider.search('', 5), []);
  assert.deepEqual(await localMemoryProvider.search('   ', 5), []);
  assert.deepEqual(await localMemoryProvider.search('!!!', 5), []);
  assert.deepEqual(await localMemoryProvider.search('"', 5), []);
  assert.deepEqual(await localMemoryProvider.search('-', 5), []);
  assert.deepEqual(await localMemoryProvider.search('AND OR NOT', 5), []);
  assert.deepEqual(searchCandidateIds(''), []);
});

test('QA-R2-EDGE: TTL cache expires after CACHE_TTL_MS', async () => {
  invalidateMemoryCache();
  putCachedSearch('qa-ttl-key', [{ id: 'x' } as any]);
  assert.ok(getCachedSearch('qa-ttl-key'), 'cache hit within TTL');
  const origNow = Date.now;
  Date.now = () => origNow() + CACHE_TTL_MS + 1000;
  try {
    assert.equal(getCachedSearch('qa-ttl-key'), undefined, 'cache expired after TTL');
  } finally {
    Date.now = origNow;
  }
  invalidateMemoryCache();
});

test('QA-R2-BUG: multi-run CJK query loses recall (AC-R2-2 regression)', async () => {
  // 旧逻辑（逐字符 tokenize + 重叠打分）对 "开源 项目" 能召回 "开源社区项目今天完成"；
  // 新逻辑把两个独立 CJK 串 join 成 "开源项目" 走 trigram，内容中不存在该连续子串 → 0 召回。
  await localMemoryProvider.add({ content: '开源社区项目今天完成', tags: [] });
  const hits = await localMemoryProvider.search('开源 项目', 5);
  assert.ok(
    hits.some((h) => h.content.includes('开源社区项目今天完成')),
    `multi-run CJK query should recall the memory (AC-R2-2), got: ${JSON.stringify(hits.map(h => h.content))}`
  );
});
