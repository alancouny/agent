import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCommand } from '../src/computer-use/handlers.js';

test('terminal: echo returns stdout', async () => {
  const res = await executeCommand({ command: 'echo hello-terminal' });
  assert.equal(res.success, true);
  assert.match(res.output, /hello-terminal/);
});

test('terminal: bad command fails gracefully', async () => {
  const res = await executeCommand({ command: 'definitely-not-a-command-xyz' });
  assert.equal(res.success, false);
  assert.ok(res.output.length > 0);
});

test('terminal: empty command is rejected', async () => {
  const res = await executeCommand({ command: '   ' });
  assert.equal(res.success, false);
  assert.match(res.output, /empty/);
});

test('terminal: invalid timeout is rejected', async () => {
  const res = await executeCommand({ command: 'echo x', timeout: 0 });
  assert.equal(res.success, false);
  assert.match(res.output, /timeout/);
});
