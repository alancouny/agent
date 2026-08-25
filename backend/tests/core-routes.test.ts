import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { agentRouter } from '../src/routes/agent.js';
import { workflowRouter } from '../src/routes/workflow.js';
import { knowledgeRouter } from '../src/routes/knowledge.js';
import { chunkText } from '../src/knowledge/store.js';
import { app as serverApp, ensureApiKey } from '../src/server.js';

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRouter);
  app.use('/api/workflow', workflowRouter);
  app.use('/api/knowledge', knowledgeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

// ── agent routes ──
test('agent: GET /tools lists registered tools incl. run_code/delegate_task', async () => {
  const res = await fetch(`${base}/agent/tools`);
  assert.equal(res.status, 200);
  const { tools } = await res.json();
  const names = tools.map((t: any) => t.name);
  assert.ok(names.includes('calculator'));
  assert.ok(names.includes('list_files'));
  assert.ok(names.includes('run_code'));
  assert.ok(names.includes('delegate_task'));
});

test('agent: POST /tools/execute runs a builtin', async () => {
  const res = await fetch(`${base}/agent/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName: 'calculator', args: { expression: '1+1' }, sessionId: 't' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(body.output, /2/);
});

test('agent: approval-required tool returns PENDING_APPROVAL', async () => {
  const res = await fetch(`${base}/agent/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName: 'write_file', args: { path: '/tmp/x', content: 'y' }, sessionId: 't' }),
  });
  const body = await res.json();
  assert.equal(body.error, 'PENDING_APPROVAL');
});

// ── workflow routes ──
test('workflow: GET /graph describes the supervisor graph', async () => {
  const res = await fetch(`${base}/workflow/graph`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.entryPoint, 'router');
  assert.deepEqual(body.nodes, ['router', 'supervisor', 'delegate', 'complete', 'error']);
  assert.ok(body.edges.length >= 10);
});

test('workflow: POST /run terminates gracefully even when the LLM is unreachable', async () => {
  // unreachable baseUrl → routerNode fails → error node → __end__ (no hang, SSE closes)
  const res = await fetch(`${base}/workflow/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'hello',
      model: 'mock',
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'x',
    }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(raw.includes('data: '), 'SSE stream received');
  assert.ok(raw.includes('"type":"done"'), 'done event terminates the stream');
});

// ── knowledge basics ──
test('knowledge: chunkText splits long text into bounded chunks', () => {
  const long = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} contains enough text about the topic to force splitting into multiple bounded chunks with some overlap.`).join('\n\n');
  const chunks = chunkText(long);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000);
});

test('knowledge: /search returns an array even with no embeddings (degrades gracefully)', async () => {
  const res = await fetch(`${base}/knowledge/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'anything' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.results));
});

test('knowledge: /config returns the current RAG config', async () => {
  const res = await fetch(`${base}/knowledge/config`);
  assert.equal(res.status, 200);
  const { config } = await res.json();
  assert.ok(config.embeddingModel);
  assert.ok(config.chunkSize > 0);
});

// ── thinkingMode wiring ──
test('agent: POST /chat accepts thinkingMode and still streams a done event', async () => {
  const res = await fetch(`${base}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'hi',
      model: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      thinkingMode: true,
      stream: true,
    }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  // 无 API key 时产出 error 事件后仍以 done 收尾（配置透传不破坏流）
  assert.match(text, /"type":"done"/);
});

// ── 决策 A（R4 前置 #23）：默认强制鉴权 ──
// 无 AGENT_API_KEY 时 ensureApiKey() 生成随机 key，未带鉴权请求必须 401；
// 健康检查（免鉴权路由）仍放行且带 X-Request-Id。
test('agent: default auth — unauthenticated requests are 401 even without AGENT_API_KEY', async () => {
  const srv = await new Promise<any>((resolve) => {
    const s = serverApp.listen(0, () => resolve(s));
  });
  try {
    const realBase = `http://localhost:${srv.address().port}/api`;

    // 无鉴权 → 401
    const noAuth = await fetch(`${realBase}/agent/tools`);
    assert.equal(noAuth.status, 401);
    const noAuthBody = await noAuth.json();
    assert.equal(noAuthBody.error, 'Unauthorized: missing or invalid API key');

    // 带随机 key → 放行
    const key = ensureApiKey();
    const withAuth = await fetch(`${realBase}/agent/tools`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    assert.equal(withAuth.status, 200);

    // 健康检查（SKIP_AUTH 默认 /api/health）免鉴权且带 requestId
    const health = await fetch(`${realBase}/health`);
    assert.equal(health.status, 200);
    assert.ok(health.headers.get('x-request-id'), 'health response carries X-Request-Id');
    await health.text();
  } finally {
    srv.close();
  }
});
