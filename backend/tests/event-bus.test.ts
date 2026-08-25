import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentEventBus } from '../src/agent/event-bus.js';
import { AgentCore } from '../src/agent/core.js';

test('AgentEventBus: broadcasts on generic + typed channels', () => {
  const bus = new AgentEventBus();
  const all: string[] = [];
  const texts: string[] = [];
  bus.on('event', (e) => all.push(e.type));
  bus.onType('text', (e) => texts.push(e.content));

  bus.emitEvent({ type: 'text', content: 'hello', turnIdx: 1, stepIdx: 1 });
  bus.emitEvent({ type: 'thinking', content: 'x', turnIdx: 1, stepIdx: 1 });

  assert.deepEqual(all, ['text', 'thinking'], 'generic channel gets every event');
  assert.deepEqual(texts, ['hello'], 'typed channel filters by type');
});

// D2：AgentCore.run 通过 eventBus 广播事件（不再依赖 AsyncGenerator），
// 且对不可达模型快速失败并 emit error 事件（不抛到调用方）。
test('AgentCore.run emits events via eventBus (no network, fast fail)', async () => {
  const bus = new AgentEventBus();
  const types: string[] = [];
  bus.on('event', (e) => types.push(e.type));

  const core = new AgentCore(
    {
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'http://127.0.0.1:1/v1', // 不可达 → 快速失败
      apiKey: 'x',
      maxIterations: 1,
    },
    'eb-test'
  );

  await core.run('hi', { eventBus: bus });

  assert.ok(types.length > 0, 'bus received at least one event');
  assert.ok(
    types.includes('error') || types.includes('thinking'),
    'emitted lifecycle events (got: ' + types.join(',') + ')'
  );
});
