import test from 'node:test';
import assert from 'node:assert/strict';
import { runInIsolatedVm } from '../src/sandbox/isolated.js';

const deps = {
  toolsCall: async (name: string) => `TOOL_RESULT:${name}`,
  toolsList: () => ['web_search', 'calculator'],
};

test('sandbox: executes sync user code and returns the value', async () => {
  const r = await runInIsolatedVm('return 1 + 2;', deps);
  assert.equal(r.value, '3');
  assert.equal(r.timedOut, false);
});

test('sandbox: top-level await on the tools bridge works', async () => {
  const r = await runInIsolatedVm(
    'const a = await tools.call("web_search");\nreturn a + "|" + tools.list().join(",");',
    deps
  );
  assert.equal(r.value, 'TOOL_RESULT:web_search|web_search,calculator');
});

test('sandbox: console.log is captured into logs', async () => {
  const r = await runInIsolatedVm('console.log("hello", 42);\nreturn "done";', deps);
  assert.equal(r.value, 'done');
  assert.ok(r.logs.includes('hello 42'));
});

test('sandbox: JSON/Math/Date globals are usable', async () => {
  const r = await runInIsolatedVm(
    'const o = { k: 1 };\nreturn JSON.stringify(o) + "|" + Math.sqrt(16) + "|" + (new Date() instanceof Date);',
    deps
  );
  assert.equal(r.value, '{"k":1}|4|true');
});

test('sandbox: thrown errors surface with message', async () => {
  // 用户代码抛错 → 宿主 reject（与旧 node:vm 行为的工具失败语义一致）
  await assert.rejects(() => runInIsolatedVm('throw new Error("boom");', deps), /boom/);
});

test('sandbox: no process/require globals (isolation)', async () => {
  const r = await runInIsolatedVm('return typeof process + "|" + typeof require;', deps);
  assert.equal(r.value, 'undefined|undefined');
});

test('sandbox: prototype-chain escape attempt is blocked', async () => {
  const r = await runInIsolatedVm(
    'try { this.constructor.constructor("return process")().cwd(); return "ESCAPED"; } catch (e) { return "blocked"; }',
    deps
  );
  assert.equal(r.value, 'blocked');
});

test('sandbox: memory limit kills runaway allocation', async () => {
  const r = await runInIsolatedVm(
    'const a = []; while (true) a.push(new Array(1e6).fill(1));\nreturn "done";',
    deps,
    { memoryLimitMb: 16, timeoutMs: 10_000 }
  );
  assert.equal(r.memoryLimited, true);
});

test('sandbox: execution timeout is enforced', async () => {
  const r = await runInIsolatedVm(
    'while (true) {}\nreturn "never";',
    deps,
    { memoryLimitMb: 64, timeoutMs: 800 }
  );
  assert.equal(r.timedOut, true);
});
