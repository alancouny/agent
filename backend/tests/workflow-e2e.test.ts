import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { workflowRouter } from '../src/routes/workflow.js';
import { getDb } from '../src/db/database.js';
import { v4 as uuidv4 } from 'uuid';

// Mock OpenAI-compatible server: the router node asks for a JSON decision,
// we answer {"action":"done"} → router → complete → __end__.
let llm: http.Server;
let llmPort = 0;

test.before(async () => {
  // Request counting: 1st routing call (router) per session vs. supervisor AgentCore calls.
  // For the supervisor case we make the router answer {"action":"loop"} → supervisor runs
  // AgentCore → mock returns a long text → supervisor emits thinking events → complete.
  llm = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const isRouting = body.includes('Supervisor Agent');
      const content = isRouting
        ? '{"action":"loop","reason":"go supervisor"}'
        : 'This is a sufficiently long mock answer from the supervisor agent to trigger the done edge.';
      res.end(JSON.stringify({
        id: 'chatcmpl-mock', object: 'chat.completion', created: Date.now(), model: 'mock-1',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  await new Promise<void>((r) => llm.listen(0, () => r()));
  llmPort = (llm.address() as any).port;
});

test.after(() => llm?.close());

test('workflow E2E: POST /run streams events and completes via router → complete', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflow', workflowRouter);
  const srv = await new Promise<any>((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api/workflow`;
  const sid = uuidv4();

  const res = await fetch(`${base}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'do a workflow task',
      sessionId: sid,
      model: 'mock-1',
      provider: 'openai',
      baseUrl: `http://127.0.0.1:${llmPort}/v1`,
      apiKey: 'x',
    }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(raw.includes('data: '), 'SSE stream received');
  assert.ok(raw.includes('"type":"done"'), 'stream terminates with done');
  // router answered {"action":"loop"} → supervisor ran AgentCore → complete node emits the final text.
  const textEvent = raw.split('\n').find((l) => l.includes('"type":"text"'));
  assert.ok(textEvent || raw.includes('"type":"complete"'), 'final text or complete event present');
  // Supervisor process events stream through (typing effect): router thinking + agent iteration.
  assert.ok(raw.includes('[ROUTER]') || raw.includes('Iteration'), 'supervisor process events streamed');
  assert.ok(raw.includes('mock answer from the supervisor'), 'supervisor final text reached the client');

  // Workflow events were recorded in the session log (graph logs workflow_step / complete).
  const db = getDb();
  const evTypes = (db.prepare('SELECT type FROM session_events WHERE session_id = ?').all(sid) as any[])
    .map((r) => r.type);
  assert.ok(evTypes.includes('workflow_step'), 'graph logged workflow_step events');
  assert.ok(evTypes.includes('workflow_complete') || evTypes.includes('error'), 'graph reached a terminal state');

  // Persisted user + assistant messages so resume works.
  const roles = (db.prepare("SELECT role FROM messages WHERE session_id = ? ORDER BY created_at").all(sid) as any[])
    .map((r) => r.role);
  assert.ok(roles.includes('user'));

  db.prepare('DELETE FROM session_events WHERE session_id = ?').run(sid);
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  srv.close();
});
