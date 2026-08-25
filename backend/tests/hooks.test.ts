import test from 'node:test';
import assert from 'node:assert/strict';
import { executeHooks, type AgentHooksConfig } from '../src/agent/hooks.js';

test('hooks: no hooks configured → continue without changes', async () => {
  const res = await executeHooks(undefined, { userMessage: 'hi' } as any);
  assert.equal(res.aborted, false);
  assert.deepEqual(res.ctx, { userMessage: 'hi' });
});

test('hooks: abort short-circuits and reports the message', async () => {
  const hooks: AgentHooksConfig = {
    beforeRun: [(ctx) => ({ action: 'abort', message: 'stop right there' })],
  };
  const res = await executeHooks(hooks.beforeRun, { userMessage: 'hi' });
  assert.equal(res.aborted, true);
  assert.equal(res.message, 'stop right there');
});

test('hooks: modify merges only specified fields', async () => {
  const hooks: AgentHooksConfig = {
    beforeModelCall: [(ctx) => ({ action: 'modify', payload: { extra: 1 } })],
  };
  const res = await executeHooks(hooks.beforeModelCall, { apiMessages: [], iteration: 3 });
  assert.equal(res.aborted, false);
  assert.equal((res.ctx as any).iteration, 3, 'original field preserved');
  assert.equal((res.ctx as any).extra, 1, 'new field merged');
  assert.deepEqual((res.ctx as any).apiMessages, [], 'unchanged array preserved');
});

test('hooks: multiple hooks run in order, last modify wins per field', async () => {
  const hooks: AgentHooksConfig = {
    beforeToolCall: [
      (ctx) => ({ action: 'modify', payload: { args: { a: 1 } } }),
      (ctx) => ({ action: 'modify', payload: { args: { a: 2, b: 3 } } }),
    ],
  };
  const res = await executeHooks(hooks.beforeToolCall, { toolName: 'calc', args: { a: 0 } });
  assert.equal((res.ctx as any).args.a, 2);
  assert.equal((res.ctx as any).args.b, 3);
});

test('hooks: an abort in the middle stops remaining hooks', async () => {
  let ran = 0;
  const hooks: AgentHooksConfig = {
    beforeRun: [
      (ctx) => { ran++; return { action: 'modify' as const, payload: { x: 1 } }; },
      () => { ran++; return { action: 'abort' as const, message: 'nope' }; },
      () => { ran++; return { action: 'modify' as const, payload: { y: 2 } }; },
    ],
  };
  const res = await executeHooks(hooks.beforeRun, { userMessage: 'go' });
  assert.equal(res.aborted, true);
  assert.equal(ran, 2, 'third hook never ran');
});
