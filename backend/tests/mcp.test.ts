import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { mcpManager } from '../src/mcp/manager.js';
import { toolRegistry, executeTool, isApprovalRequired, setApprovalRequired } from '../src/tools/registry.js';
import { classifyDanger } from '../src/tools/dangerous.js';
import { mcpStore, type McpServerConfig } from '../src/mcp/store.js';
import { mcpRouter } from '../src/routes/mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'src', 'mcp', 'fixtures', 'echo-server.mjs');
const DANGEROUS_FIXTURE = path.join(__dirname, '..', 'src', 'mcp', 'fixtures', 'dangerous-server.mjs');

// JSON 存储隔离：备份/恢复真实 data/mcp_servers.json，避免测试残留污染开发配置
// （沿用 prompts.test.ts 的备份/恢复模式）。
const STORE_FILE = path.join(__dirname, '..', 'data', 'mcp_servers.json');
let backup: string | null = null;

test.before(() => {
  if (fs.existsSync(STORE_FILE)) backup = fs.readFileSync(STORE_FILE, 'utf-8');
});
test.after(() => {
  if (backup !== null) fs.writeFileSync(STORE_FILE, backup);
  else if (fs.existsSync(STORE_FILE)) fs.rmSync(STORE_FILE, { force: true });
});

function registerFixture(overrides: Partial<McpServerConfig> = {}) {
  return mcpStore.add({
    name: 'echo-e2e',
    transport: 'stdio',
    command: process.execPath,
    args: FIXTURE,
    autostart: false,
    allowedTools: ['mcp__echo-e2e__ping'],
    ...overrides,
  });
}

function registerDangerousFixture(allowedTools: string[]) {
  return mcpStore.add({
    name: 'dangerous-e2e',
    transport: 'stdio',
    command: process.execPath,
    args: DANGEROUS_FIXTURE,
    autostart: false,
    allowedTools,
  });
}

test('MCP: connect stdio fixture, discover & execute ping, disconnect unregisters', async () => {
  const config = registerFixture();
  const id = config.id;

  const status = await mcpManager.connect(id);
  assert.equal(status.connected, true, status.error || 'should connect');
  assert.deepEqual(status.allowedTools, ['mcp__echo-e2e__ping'], 'allowedTools exposed on status');
  assert.ok(status.tools.some((t) => t.name === 'mcp__echo-e2e__ping'), 'bridged tool name exposed');

  // Bridged tool is in the shared registry
  const bridged = toolRegistry.get('mcp__echo-e2e__ping');
  assert.ok(bridged, 'mcp__echo-e2e__ping registered');
  assert.equal(bridged.dangerous, false, 'ping is not dangerous');

  // Execute the bridged handler directly (MCP tools are approval-gated; the registry
  // approval gate is covered elsewhere, so call the handler to avoid a PENDING_APPROVAL).
  const res = await bridged.handler({ message: 'hi' }, { sessionId: 'mcp-test' });
  assert.equal(res.success, true);
  assert.match(res.output, /pong: hi/, 'ping echoes input');

  // Disconnect unregisters the bridged tools
  await mcpManager.disconnect(id);
  assert.ok(!toolRegistry.get('mcp__echo-e2e__ping'), 'tool unregistered after disconnect');

  mcpStore.remove(id);
});

test('MCP: unknown server returns disconnected status without throwing', async () => {
  const status = await mcpManager.connect('does-not-exist');
  assert.equal(status.connected, false);
  assert.ok(status.error);
});

// AC-R5-2：fail-closed —— 未配置 allowedTools 的服务器连接后不暴露任何工具
test('MCP: fail-closed — no allowedTools exposes zero tools (AC-R5-2)', async () => {
  const config = registerFixture({ allowedTools: undefined });
  const id = config.id;

  const status = await mcpManager.connect(id);
  assert.equal(status.connected, true, status.error || 'should connect');
  assert.equal(status.tools.length, 0, 'no tools exposed when allowedTools missing');
  assert.deepEqual(status.allowedTools, [], 'allowedTools empty');

  assert.ok(!toolRegistry.get('mcp__echo-e2e__ping'), 'ping NOT registered (fail-closed)');

  // GET /:id/tools 视角：发现到的工具全部标记 allowed=false（面板可展示被拦截项）
  const info = mcpManager.listTools(id) ?? [];
  assert.ok(info.length >= 1, 'discovered tools still listed with flags');
  const ping = info.find((t) => t.name === 'mcp__echo-e2e__ping');
  assert.ok(ping, 'ping present in full list');
  assert.equal(ping.allowed, false, 'ping blocked');

  // 未注册 → executeTool 返回 TOOL_NOT_FOUND
  const exec = await executeTool('mcp__echo-e2e__ping', { message: 'hi' }, { sessionId: 'mcp-test' });
  assert.equal(exec.error, 'TOOL_NOT_FOUND');

  await mcpManager.disconnect(id);
  mcpStore.remove(id);
});

// AC-R5-1：白名单仅放行 —— 白名单外工具不注册、LLM schema 不可见、executeTool TOOL_NOT_FOUND
test('MCP: whitelist filters tools — non-whitelisted not registered (AC-R5-1)', async () => {
  const config = registerDangerousFixture(['mcp__dangerous-e2e__read_note']);
  const id = config.id;

  const status = await mcpManager.connect(id);
  assert.equal(status.connected, true, status.error || 'should connect');
  assert.ok(status.tools.some((t) => t.name === 'mcp__dangerous-e2e__read_note'), 'read_note exposed');
  assert.ok(!status.tools.some((t) => t.name === 'mcp__dangerous-e2e__write_file'), 'write_file not exposed');

  assert.ok(toolRegistry.get('mcp__dangerous-e2e__read_note'), 'read_note registered');
  assert.ok(!toolRegistry.get('mcp__dangerous-e2e__write_file'), 'write_file NOT registered');
  assert.ok(!toolRegistry.get('mcp__dangerous-e2e__exec'), 'exec NOT registered');
  assert.ok(
    !toolRegistry.getSchemas().some((s) => s.name === 'mcp__dangerous-e2e__write_file'),
    'write_file absent from LLM schemas'
  );

  const exec = await executeTool('mcp__dangerous-e2e__write_file', { path: '/tmp/x' }, { sessionId: 'mcp-test' });
  assert.equal(exec.error, 'TOOL_NOT_FOUND', 'non-whitelisted tool not executable');

  await mcpManager.disconnect(id);
  mcpStore.remove(id);
});

// AC-R5-3：危险工具不可豁免 —— 全局审批关闭时危险 MCP 工具仍 PENDING_APPROVAL，非危险豁免
test('MCP: dangerous tools force approval even when global toggle is off (AC-R5-3)', async () => {
  const wasRequired = isApprovalRequired();
  const config = registerDangerousFixture([
    'mcp__dangerous-e2e__write_file',
    'mcp__dangerous-e2e__read_note',
  ]);
  const id = config.id;

  try {
    const status = await mcpManager.connect(id);
    assert.equal(status.connected, true, status.error || 'should connect');

    // 面板标记：write_file 危险 + 强制审批；read_note 不危险
    const info = mcpManager.listTools(id) ?? [];
    const wf = info.find((t) => t.name === 'mcp__dangerous-e2e__write_file');
    const rn = info.find((t) => t.name === 'mcp__dangerous-e2e__read_note');
    assert.ok(wf, 'write_file listed');
    assert.equal(wf.dangerous, true, 'write_file flagged dangerous');
    assert.equal(wf.forcedApproval, true, 'write_file forced approval');
    assert.equal(wf.allowed, true);
    assert.ok(rn, 'read_note listed');
    assert.equal(rn.dangerous, false, 'read_note not dangerous');
    assert.equal(rn.forcedApproval, false);

    // 全局审批关闭
    setApprovalRequired(false);

    // 危险工具仍必须审批
    const dangerousExec = await executeTool('mcp__dangerous-e2e__write_file', { path: '/tmp/x', content: 'y' }, { sessionId: 'mcp-test' });
    assert.equal(dangerousExec.error, 'PENDING_APPROVAL', 'dangerous MCP tool still gated with global off');

    // 非危险 MCP 工具豁免（按原逻辑 requiresApproval + 全局开关）
    const safeExec = await executeTool('mcp__dangerous-e2e__read_note', { id: 'n1' }, { sessionId: 'mcp-test' });
    assert.equal(safeExec.success, true, 'non-dangerous MCP tool runs when global off');
    assert.match(safeExec.output, /note: n1/);
  } finally {
    setApprovalRequired(wasRequired);
    await mcpManager.disconnect(id);
    mcpStore.remove(id);
  }
});

// 回归：R5 判定边界 —— rmdir（rm -rf 类目录删除语义）必须被识别为文件写危险（QA-R5-EDGE 缺口）
test('MCP: rmdir is classified as dangerous file-write (regression)', () => {
  assert.equal(classifyDanger('rmdir'), 'file_write');
  assert.equal(classifyDanger('rm'), 'file_write', 'bare rm flagged');
  // 下划线连接名与词边界规则互不干扰：write_file 仍命中；rm_rf 属 "只补 rmdir" 之外的已知边界
  assert.equal(classifyDanger('write_file'), 'file_write');
});

// ── 路由层：POST 带 allowedTools、PUT 更新、GET /:id/tools 标注 ──
async function withMcpServer(fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRouter);
  const srv = await new Promise<any>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(`http://localhost:${srv.address().port}/api/mcp`);
  } finally {
    srv.close();
  }
}

test('MCP routes: POST/PUT allowedTools + GET /:id/tools annotations', async () => {
  await withMcpServer(async (mcpBase) => {
    // POST 允许带 allowedTools（S6）
    const create = await fetch(`${mcpBase}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'route-e2e',
        transport: 'stdio',
        command: process.execPath,
        args: FIXTURE,
        autostart: false,
        allowedTools: ['mcp__route-e2e__ping'],
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.deepEqual(created.server.allowedTools, ['mcp__route-e2e__ping']);

    // 非法 allowedTools → 400
    const bad = await fetch(`${mcpBase}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'route-bad', transport: 'stdio', command: 'npx', allowedTools: 'not-an-array' }),
    });
    assert.equal(bad.status, 400);

    // 连接后 GET /:id/tools 返回标注
    const conn = await fetch(`${mcpBase}/${created.server.id}/connect`, { method: 'POST' });
    assert.equal(conn.status, 200);
    const connBody = await conn.json();
    assert.equal(connBody.status.connected, true);

    const toolsRes = await fetch(`${mcpBase}/${created.server.id}/tools`);
    assert.equal(toolsRes.status, 200);
    const toolsBody = await toolsRes.json();
    const ping = toolsBody.tools.find((t: any) => t.name === 'mcp__route-e2e__ping');
    assert.ok(ping, 'ping in tools list');
    assert.equal(ping.allowed, true);
    assert.equal(ping.dangerous, false);
    assert.equal(ping.forcedApproval, false);

    // PUT 更新白名单（清空 → 已连接提示需重连，S5）
    const put = await fetch(`${mcpBase}/${created.server.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedTools: [] }),
    });
    assert.equal(put.status, 200);
    const putBody = await put.json();
    assert.deepEqual(putBody.server.allowedTools, []);
    assert.equal(putBody.connected, true, 'connected flag reported');
    assert.ok(putBody.note, 'reconnect note present when connected');

    // 未连接服务器 GET tools → 空列表
    const offRes = await fetch(`${mcpBase}/${created.server.id}/disconnect`, { method: 'POST' });
    assert.equal(offRes.status, 200);
    const offTools = await fetch(`${mcpBase}/${created.server.id}/tools`);
    const offBody = await offTools.json();
    assert.equal(offBody.count, 0, 'disconnected server has no tools');

    await fetch(`${mcpBase}/${created.server.id}`, { method: 'DELETE' });
  });
});
