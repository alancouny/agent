import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { llmTracer } from '../src/telemetry/llm-trace.js';
import { telemetryRouter } from '../src/routes/telemetry.js';

test('telemetry: tracer records begin/end lifecycle', () => {
  llmTracer.clear();
  const id = llmTracer.begin({ sessionId: 's1', agentKind: 'main', parentId: null, model: 'gpt-4o', turn: 1, step: 1 });
  llmTracer.end(id, { promptTokens: 10, completionTokens: 20, toolNames: ['web_search'], contentPreview: 'hello' });
  const calls = llmTracer.list('s1');
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.model, 'gpt-4o');
  assert.equal(c.totalTokens, 30);
  assert.deepEqual(c.toolNames, ['web_search']);
  assert.ok(c.durationMs >= 0 && c.endAt >= c.startAt);
  assert.equal(c.contentPreview, 'hello');
});

test('telemetry: parent/child dependency chain', () => {
  llmTracer.clear();
  const parent = llmTracer.begin({ sessionId: 's1', agentKind: 'main', parentId: null, model: 'gpt-4o', turn: 1, step: 1 });
  const child = llmTracer.begin({ sessionId: 's1', agentKind: 'delegate', parentId: parent, model: 'deepseek', turn: 0, step: 0 });
  llmTracer.end(parent, { contentPreview: 'p' });
  llmTracer.end(child, { contentPreview: 'c' });
  const calls = llmTracer.list('s1');
  const childRec = calls.find((c) => c.id === child)!;
  assert.equal(childRec.parentId, parent);
  assert.equal(childRec.agentKind, 'delegate');
});

test('telemetry: list filters by session and caps at limit', () => {
  llmTracer.clear();
  for (let i = 0; i < 5; i++) {
    const id = llmTracer.begin({ sessionId: 'sA', agentKind: 'main', parentId: null, model: 'm', turn: 0, step: 0 });
    llmTracer.end(id, {});
  }
  llmTracer.begin({ sessionId: 'sB', agentKind: 'main', parentId: null, model: 'm', turn: 0, step: 0 });
  assert.equal(llmTracer.list('sA').length, 5);
  assert.equal(llmTracer.list('sA', 2).length, 2);
  assert.equal(llmTracer.list().length, 6);
});

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use('/api/telemetry', telemetryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

test('telemetry: GET /llm-calls returns records', async () => {
  llmTracer.clear();
  const id = llmTracer.begin({ sessionId: 'http1', agentKind: 'main', parentId: null, model: 'gpt-4o', turn: 1, step: 1 });
  llmTracer.end(id, { promptTokens: 5, completionTokens: 5 });
  const res = await fetch(`${base}/telemetry/llm-calls?sessionId=http1`);
  assert.equal(res.status, 200);
  const { calls, count } = await res.json();
  assert.equal(count, 1);
  assert.equal(calls[0].sessionId, 'http1');
});

test('telemetry: DELETE /llm-calls clears session', async () => {
  llmTracer.clear();
  const id = llmTracer.begin({ sessionId: 'clr', agentKind: 'main', parentId: null, model: 'm', turn: 0, step: 0 });
  llmTracer.end(id, {});
  await fetch(`${base}/telemetry/llm-calls?sessionId=clr`, { method: 'DELETE' });
  assert.equal(llmTracer.list('clr').length, 0);
});
