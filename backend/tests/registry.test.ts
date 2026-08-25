import test from 'node:test';
import assert from 'node:assert/strict';
import { toolRegistry, executeTool, isApprovalRequired, setApprovalRequired } from '../src/tools/registry.js';
import '../src/tools/builtin.js';
import '../src/tools/system-tools.js';
import '../src/tools/agent-meta-tools.js';

// write_file/read_file 受 workspace 根约束；测试写 /tmp 需把工作区指到 /tmp
process.env.WORKSPACE_ROOT = '/tmp';

test('registry: register + get + getSchemas (enabled only)', () => {
  const def = toolRegistry.get('calculator');
  assert.ok(def, 'calculator is registered');
  assert.equal(def!.category, 'utility');
  const schemas = toolRegistry.getSchemas();
  assert.ok(schemas.some((s) => s.name === 'calculator'));
});

test('registry: disabled tool excluded from getSchemas and blocked on execute', async () => {
  toolRegistry.register('test_disabled_tool', {
    schema: { name: 'test_disabled_tool', description: 'x', parameters: { type: 'object', properties: {}, required: [] } },
    handler: async () => ({ success: true, output: 'should not run' }),
    category: 'test',
    requiresApproval: false,
    enabled: false,
  });
  assert.ok(!toolRegistry.getSchemas().some((s) => s.name === 'test_disabled_tool'));
  const res = await executeTool('test_disabled_tool', {}, { sessionId: 't' });
  assert.equal(res.error, 'TOOL_DISABLED');
  toolRegistry.unregister('test_disabled_tool');
});

test('registry: executeTool runs handler and returns output', async () => {
  const res = await executeTool('calculator', { expression: '2+3*4' }, { sessionId: 't' });
  assert.equal(res.success, true);
  assert.match(res.output, /14/);
});

test('registry: approval gate returns PENDING_APPROVAL and bypasses when disabled', async () => {
  const wasRequired = isApprovalRequired();
  try {
    setApprovalRequired(true);
    const res = await executeTool('write_file', { path: '/tmp/x', content: 'y' }, { sessionId: 't' });
    assert.equal(res.error, 'PENDING_APPROVAL');

    setApprovalRequired(false);
    const res2 = await executeTool('write_file', { path: '/tmp/reg-test.txt', content: 'hello' }, { sessionId: 't' });
    assert.equal(res2.success, true);
  } finally {
    setApprovalRequired(wasRequired);
  }
});

test('registry: readOnly tools are flagged for parallel scheduling', () => {
  const listFiles = toolRegistry.get('list_files');
  assert.equal(listFiles?.readOnly, true, 'list_files is read-only');
  const calc = toolRegistry.get('calculator');
  assert.equal(calc?.readOnly, true, 'calculator is read-only');
  const write = toolRegistry.get('write_file');
  assert.ok(!write?.readOnly, 'write_file is NOT read-only');
});

test('registry: agent meta-tools registered (delegate_task, run_code)', () => {
  assert.ok(toolRegistry.get('delegate_task'), 'delegate_task registered');
  assert.ok(toolRegistry.get('run_code'), 'run_code registered');
});

test('registry: dangerous tools cannot bypass approval when global toggle is off (AC-R5-3)', async () => {
  const wasRequired = isApprovalRequired();
  toolRegistry.register('test_dangerous_gate', {
    schema: { name: 'test_dangerous_gate', description: 'x', parameters: { type: 'object', properties: {}, required: [] } },
    handler: async () => ({ success: true, output: 'ran' }),
    category: 'test',
    requiresApproval: true,
    dangerous: true, // 仅 MCP 注册路径会写入该标记
    enabled: true,
  });
  try {
    setApprovalRequired(false);
    const res = await executeTool('test_dangerous_gate', {}, { sessionId: 't' });
    assert.equal(res.error, 'PENDING_APPROVAL', 'dangerous tool still gated with global off');
    // 非危险 requiresApproval 工具在全局关闭时豁免（AC-R5-4：内置工具行为不变）
    const res2 = await executeTool('write_file', { path: '/tmp/reg-safe.txt', content: 'hello' }, { sessionId: 't' });
    assert.equal(res2.success, true, 'non-dangerous builtin tool exempt when global off');
  } finally {
    setApprovalRequired(wasRequired);
    toolRegistry.unregister('test_dangerous_gate');
  }
});
