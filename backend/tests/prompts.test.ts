import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import { promptsRouter } from '../src/routes/prompts.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'prompts.json');
let backup: string | null = null;

test.before(() => {
  if (fs.existsSync(FILE)) backup = fs.readFileSync(FILE, 'utf-8');
});
test.after(() => {
  if (backup !== null) fs.writeFileSync(FILE, backup);
  else if (fs.existsSync(FILE)) fs.rmSync(FILE, { force: true });
});

let server: any;
let base: string;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/prompts', promptsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api/prompts`;
});

test.after(() => server?.close());

test('prompts: CRUD round-trip', async () => {
  // create
  const create = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test-prompt', content: 'Summarize {{topic}}' }),
  });
  assert.equal(create.status, 200);
  const { prompt: item } = await create.json();
  assert.ok(item.id);
  assert.deepEqual(item.variables, ['topic'], 'variables extracted');

  // list
  const list = await fetch(base);
  const { prompts } = await list.json();
  assert.ok(prompts.some((p: any) => p.id === item.id));

  // update
  const update = await fetch(`${base}/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'renamed', content: 'Now about {{topic}} and {{detail}}' }),
  });
  assert.equal(update.status, 200);
  const { prompt: updated } = await update.json();
  assert.equal(updated.name, 'renamed');
  assert.ok(updated.variables.includes('detail'));

  // delete
  const del = await fetch(`${base}/${item.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const list2 = await fetch(base);
  const { prompts: p2 } = await list2.json();
  assert.ok(!p2.some((p: any) => p.id === item.id));
});
