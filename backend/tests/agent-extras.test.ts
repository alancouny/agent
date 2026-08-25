import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { agentRouter } from '../src/routes/agent.js';
import { getDb } from '../src/db/database.js';
import { v4 as uuidv4 } from 'uuid';

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api/agent`;
});

test.after(() => server?.close());

test('agent-extras: /fork copies messages into a new session', async () => {
  const db = getDb();
  const sid = uuidv4();
  db.prepare('INSERT INTO sessions (id,title,model,provider) VALUES (?,?,?,?)').run(sid, 'src', 'm', 'openai');
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?,?,'user',?)").run(uuidv4(), sid, 'hello');
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?,?,'assistant',?)").run(uuidv4(), sid, 'hi there');

  const res = await fetch(`${base}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sid }),
  });
  assert.equal(res.status, 200);
  const { newSessionId } = await res.json();
  assert.ok(newSessionId && newSessionId !== sid, 'new session id generated');

  const copied = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at').all(newSessionId) as any[];
  assert.equal(copied.length, 2);
  assert.equal(copied[1].content, 'hi there');

  db.prepare('DELETE FROM messages WHERE session_id = ?').run(newSessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(newSessionId);
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
});

test('agent-extras: /search returns matching messages', async () => {
  const db = getDb();
  const sid = uuidv4();
  db.prepare('INSERT INTO sessions (id,title,model,provider) VALUES (?,?,?,?)').run(sid, 's', 'm', 'openai');
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?,?,'user',?)").run(uuidv4(), sid, 'unique-needle-keyword-42');

  const res = await fetch(`${base}/search?q=needle`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.results.some((r: any) => r.content.includes('needle')));

  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
});

test('agent-extras: /tokens sums usage per session', async () => {
  const db = getDb();
  const sid = uuidv4();
  db.prepare('INSERT INTO sessions (id,title,model,provider) VALUES (?,?,?,?)').run(sid, 't', 'm', 'openai');
  db.prepare("INSERT INTO usage_log (id, session_id, prompt_tokens, completion_tokens, total_tokens, model) VALUES (?,?,?,?,?,?)")
    .run(uuidv4(), sid, 100, 50, 150, 'm');
  db.prepare("INSERT INTO usage_log (id, session_id, prompt_tokens, completion_tokens, total_tokens, model) VALUES (?,?,?,?,?,?)")
    .run(uuidv4(), sid, 200, 100, 300, 'm');

  const res = await fetch(`${base}/tokens?sessionId=${sid}`);
  assert.equal(res.status, 200);
  const { tokens } = await res.json();
  assert.equal(tokens.total, 450);
  assert.equal(tokens.prompt, 300);

  db.prepare('DELETE FROM usage_log WHERE session_id = ?').run(sid);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
});
