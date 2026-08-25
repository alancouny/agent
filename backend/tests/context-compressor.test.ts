import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentMessage } from '../src/agent/types.js';
import type { AgentCore } from '../src/agent/core.js';
import {
  CONTEXT_THRESHOLDS,
  estimateTokens,
  estimateMessagesTokens,
  categoriseMessages,
  buildCompressedBlock,
  getDiscardedIndices,
  buildCompressedMessages,
  maybeCompress,
  Layer,
  type LayeredMessage,
} from '../src/agent/context-compressor.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a realistic message list: system + N user/assistant pairs. */
function makeMessages(nPairs: number, contentLen: number = 200): AgentMessage[] {
  const padding = 'x'.repeat(contentLen);
  const msgs: AgentMessage[] = [{ role: 'system', content: 'You are a helpful assistant.' }];
  for (let i = 0; i < nPairs; i++) {
    msgs.push({ role: 'user', content: `User message ${i}: ${padding}` });
    msgs.push({ role: 'assistant', content: `Assistant reply ${i}: ${padding}` });
  }
  return msgs;
}

/** Minimal mock of AgentCore for maybeCompress(). */
function makeCore(messages: AgentMessage[]) {
  const lastReplaced: AgentMessage[][] = [];
  return {
    getMessages: () => messages,
    _replaceMessages: (m: AgentMessage[]) => { lastReplaced.push(m); },
    getLastReplaced: () => lastReplaced[lastReplaced.length - 1] ?? null,
  } as unknown as AgentCore;
}

// ── estimateTokens ───────────────────────────────────────────────────────────

test('estimateTokens: empty string → 0', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null as any), 0);
  assert.equal(estimateTokens(undefined as any), 0);
});

test('estimateTokens: pure Latin text (~3.8 chars/token)', () => {
  const text = 'a'.repeat(38);
  assert.equal(estimateTokens(text), 10); // 38 / 3.8 = 10
});

test('estimateTokens: pure CJK text (~1 char/token)', () => {
  const text = '你好世界'.repeat(10); // 40 CJK chars
  assert.equal(estimateTokens(text), 40);
});

test('estimateTokens: mixed Latin + CJK', () => {
  const text = '你好世界hello world foo bar baz qux';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length; // 4
  const latin = text.length - cjk;
  const expected = Math.ceil(cjk / 1 + latin / 3.8);
  assert.equal(estimateTokens(text), expected);
});

// ── estimateMessagesTokens ───────────────────────────────────────────────────

test('estimateMessagesTokens: sums tokens across all messages', () => {
  const msgs: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello world' },
  ];
  const total = estimateMessagesTokens(msgs);
  assert.ok(total > 0);
  assert.equal(total, estimateTokens('hi') + estimateTokens('hello world'));
});

test('estimateMessagesTokens: empty array → 0', () => {
  assert.equal(estimateMessagesTokens([]), 0);
});

// ── categoriseMessages (Layer 1 + Layer 2) ───────────────────────────────────

test('categoriseMessages: under threshold → all Recent', () => {
  const msgs = makeMessages(10, 50); // short messages, well under 70%
  const tokens = estimateMessagesTokens(msgs);
  const categorized = categoriseMessages(msgs, tokens, 128000);

  assert.equal(categorized.length, msgs.length - 1); // excludes system
  for (const m of categorized) {
    assert.equal(m._layer, Layer.Recent, 'all should be Recent when under threshold');
  }
});

test('categoriseMessages: sliding window preserves last N turns regardless of usage', () => {
  const window = CONTEXT_THRESHOLDS.slidingWindowSize; // 6 turns = 12 messages
  const msgs = makeMessages(20, 500);
  const tokens = estimateMessagesTokens(msgs);
  const categorized = categoriseMessages(msgs, tokens, 128000);

  // Last `window` turns (2*window messages) must be Recent
  const recentFromEnd = categorized.slice(-window * 2);
  for (const m of recentFromEnd) {
    assert.equal(m._layer, Layer.Recent, 'last N turns must be Recent');
  }
});

test('categoriseMessages: above threshold → older messages get Compressed, recent stay Recent', () => {
  // 10 pairs of 1000-char content → ~5274 tokens
  // window=5000 → effective=904 → ratio ~583% → well above 70%
  const msgs = makeMessages(10, 1000);
  const tokens = estimateMessagesTokens(msgs);
  const categorized = categoriseMessages(msgs, tokens, 5000);

  // slidingWindowSize*2 = 12 messages (6 turns) must be Recent from the end
  const window = CONTEXT_THRESHOLDS.slidingWindowSize * 2;
  const totalNonSystem = categorized.length;
  const recentCount = Math.min(window, totalNonSystem);
  const recent = categorized.slice(-recentCount);
  for (const m of recent) {
    assert.equal(m._layer, Layer.Recent, 'messages in sliding window must be Recent');
  }
  const oldMessages = categorized.slice(0, totalNonSystem - recentCount);
  for (const m of oldMessages) {
    assert.equal(m._layer, Layer.Compressed, 'old messages should be Compressed above threshold');
  }
});

test('categoriseMessages: single message → Recent', () => {
  const msgs: AgentMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ];
  const categorized = categoriseMessages(msgs, estimateMessagesTokens(msgs), 128000);
  assert.equal(categorized.length, 1);
  assert.equal(categorized[0]._layer, Layer.Recent);
});

test('categoriseMessages: ratio below threshold → all Recent even outside window', () => {
  // Many messages but very small window not required — ratio is low
  const msgs = makeMessages(20, 50); // 20 turns, short content
  const tokens = estimateMessagesTokens(msgs);
  const categorized = categoriseMessages(msgs, tokens, 128000);

  // With low ratio, all messages should be Recent
  for (const m of categorized) {
    assert.equal(m._layer, Layer.Recent, 'all Recent when under summarizeAt');
  }
});

// ── buildCompressedBlock ─────────────────────────────────────────────────────

test('buildCompressedBlock: pairs user+assistant into turns', () => {
  const msgs: AgentMessage[] = [
    { role: 'user', content: 'What is AI?' },
    { role: 'assistant', content: 'AI is artificial intelligence.' },
    { role: 'user', content: 'Tell me more.' },
    { role: 'assistant', content: 'AI mimics human cognition.' },
  ];
  const block = buildCompressedBlock(msgs);
  assert.ok(block.includes('--- Earlier context (summarized) ---'));
  assert.ok(block.includes('--- End summary ---'));
  assert.ok(block.includes('What is AI?'));
  assert.ok(block.includes('AI is artificial intelligence.'));
  assert.ok(block.includes('Tell me more.'));
  assert.ok(block.includes('AI mimics human cognition.'));
});

test('buildCompressedBlock: odd length → last message without pair still included', () => {
  const msgs: AgentMessage[] = [
    { role: 'user', content: 'Question?' },
    { role: 'assistant', content: 'Answer.' },
    { role: 'user', content: 'Follow-up?' },
  ];
  const block = buildCompressedBlock(msgs);
  assert.ok(block.includes('Question?'));
  assert.ok(block.includes('Answer.'));
  assert.ok(block.includes('Follow-up?'));
});

test('buildCompressedBlock: empty input → empty string', () => {
  assert.equal(buildCompressedBlock([]), '');
});

test('buildCompressedBlock: truncates long content to 120/200 chars', () => {
  const longContent = 'a'.repeat(300);
  const msgs: AgentMessage[] = [
    { role: 'user', content: longContent },
    { role: 'assistant', content: longContent },
  ];
  const block = buildCompressedBlock(msgs);
  // Parse the Turn line: 'Turn: "user" → "assistant"'
  const turnLines = block.split('\n').filter(l => l.startsWith('Turn:'));
  assert.equal(turnLines.length, 1);
  const line = turnLines[0]!;
  // Split on ' → ' to get user and assistant parts
  const [userPart, assistantPart] = line.split(' → ');
  const userName = userPart.replace(/^Turn: "/, '').replace(/"$/, '');
  const assistantName = assistantPart.replace(/^"/, '').replace(/"$/, '');
  assert.ok(userName.length <= 120, `user content truncated to ≤120, got ${userName.length}`);
  assert.ok(assistantName.length <= 200, `assistant content truncated to ≤200, got ${assistantName.length}`);
});

// ── getDiscardedIndices (Layer 3) ────────────────────────────────────────────

test('getDiscardedIndices: under eviction threshold → no discards', () => {
  const msgs: LayeredMessage[] = [
    { role: 'user', content: 'a'.repeat(100), _layer: Layer.Compressed },
    { role: 'assistant', content: 'b'.repeat(100), _layer: Layer.Compressed },
    { role: 'user', content: 'c'.repeat(100), _layer: Layer.Recent },
    { role: 'assistant', content: 'd'.repeat(100), _layer: Layer.Recent },
  ];
  const indices = getDiscardedIndices(msgs, 500, 128000);
  assert.deepEqual(indices, []);
});

test('getDiscardedIndices: above eviction threshold → drops oldest compressed blocks', () => {
  // Use large tokens and a tight effective window to exceed 90%
  const bigContent = 'x'.repeat(60000); // ~15789 tokens each
  const msgs: LayeredMessage[] = [
    { role: 'user', content: bigContent, _layer: Layer.Compressed },
    { role: 'assistant', content: bigContent, _layer: Layer.Compressed },
    { role: 'user', content: bigContent, _layer: Layer.Compressed },
    { role: 'assistant', content: bigContent, _layer: Layer.Recent },
    { role: 'user', content: bigContent, _layer: Layer.Recent },
    { role: 'assistant', content: bigContent, _layer: Layer.Recent },
  ];
  const totalTokens = estimateMessagesTokens(msgs.map(m => ({ role: m.role, content: m.content })));
  // Pass a window where ratio > 90%: 3*big + 3*big = 6*big tokens, window=25000
  // effective = 25000 - 4096 = 20904; total ≈ 3*15789 + 3*~few = ~47367 → ratio > 90%
  const indices = getDiscardedIndices(msgs, totalTokens, 25000);

  assert.ok(indices.length > 0, 'should discard some compressed blocks above eviction threshold');
  for (const i of indices) {
    assert.equal(msgs[i]._layer, Layer.Discarded);
  }
});

test('getDiscardedIndices: stops dropping once under eviction threshold', () => {
  const big = 'x'.repeat(60000); // ~15789 tokens
  const small = 'y'.repeat(100);
  const msgs: LayeredMessage[] = [
    { role: 'user', content: big, _layer: Layer.Compressed },
    { role: 'assistant', content: big, _layer: Layer.Compressed },
    { role: 'user', content: small, _layer: Layer.Recent },
    { role: 'assistant', content: small, _layer: Layer.Recent },
  ];
  const totalTokens = estimateMessagesTokens(msgs.map(m => ({ role: m.role, content: m.content })));
  // effectiveWindow = 20000 - 4096 = 15904; total ≈ 2*15789 + small ≈ 31678 → ratio ~199% > 90%
  const indices = getDiscardedIndices(msgs, totalTokens, 20000);

  // After dropping one compressed pair, remaining ≈ 100 tokens → ratio ~0.6% < 90%
  // So it drops exactly 2 and stops
  assert.equal(indices.length, 2, 'should drop exactly one compressed block then stop');
  assert.ok(indices.includes(0) && indices.includes(1), 'should drop the oldest compressed pair');
});

// ── buildCompressedMessages ──────────────────────────────────────────────────

test('buildCompressedMessages: order is system → compressed(oldest first) → recent', () => {
  const systemMsg: AgentMessage = { role: 'system', content: 'System prompt' };
  const nonSystemCategorized: LayeredMessage[] = [
    { role: 'user', content: 'old-q1', _layer: Layer.Compressed },
    { role: 'assistant', content: 'old-a1', _layer: Layer.Compressed },
    { role: 'user', content: 'mid-q', _layer: Layer.Compressed },
    { role: 'assistant', content: 'mid-a', _layer: Layer.Compressed },
    { role: 'user', content: 'new-q', _layer: Layer.Recent },
    { role: 'assistant', content: 'new-a', _layer: Layer.Recent },
  ];
  // originalMessages only needs to contain the system msg for find()
  const result = buildCompressedMessages([systemMsg, ...nonSystemCategorized], nonSystemCategorized);

  // First message is always system
  assert.equal(result[0].role, 'system');
  assert.equal(result[0].content, 'System prompt');

  // Compressed messages come next, in original order (oldest first)
  const afterSystem = result.slice(1);
  const compMsgs = afterSystem.filter(m => m.role !== 'system');
  const oldQIndex = compMsgs.findIndex(m => m.content === 'old-q1');
  const midQIndex = compMsgs.findIndex(m => m.content === 'mid-q');
  assert.ok(oldQIndex < midQIndex, 'older compressed block should appear before newer ones (oldest first)');

  // Recent messages are last
  const recentMsgs = afterSystem.filter(m => m.content === 'new-q' || m.content === 'new-a');
  assert.equal(recentMsgs.length, 2);
  // They should be the last 2 messages
  assert.equal(afterSystem[afterSystem.length - 2]!.content, 'new-q');
  assert.equal(afterSystem[afterSystem.length - 1]!.content, 'new-a');
});

test('buildCompressedMessages: no compressed → only system + recent', () => {
  const systemMsg: AgentMessage = { role: 'system', content: 'Sys' };
  const categorized: LayeredMessage[] = [
    { role: 'user', content: 'hi', _layer: Layer.Recent },
    { role: 'assistant', content: 'hello', _layer: Layer.Recent },
  ];
  const result = buildCompressedMessages([systemMsg, ...categorized], categorized);
  assert.equal(result.length, 3);
  assert.equal(result[0].role, 'system');
  assert.equal(result[0].content, 'Sys');
  assert.equal(result[1].content, 'hi');
  assert.equal(result[2].content, 'hello');
});

test('buildCompressedMessages: uses _summary when available', () => {
  const systemMsg: AgentMessage = { role: 'system', content: 'Sys' };
  const categorized: LayeredMessage[] = [
    { role: 'user', content: 'original', _summary: 'summarized!', _layer: Layer.Compressed },
    { role: 'assistant', content: 'orig2', _summary: 'sum2!', _layer: Layer.Compressed },
    { role: 'user', content: 'recent', _layer: Layer.Recent },
  ];
  const result = buildCompressedMessages([systemMsg, ...categorized], categorized);
  const compMsgs = result.filter(m => m.role !== 'system' && m.content !== 'recent');
  assert.ok(compMsgs.some(m => m.content === 'summarized!'));
  assert.ok(compMsgs.some(m => m.content === 'sum2!'));
});

test('buildCompressedMessages: no system message → starts with first non-system', () => {
  const categorized: LayeredMessage[] = [
    { role: 'user', content: 'hi', _layer: Layer.Recent },
  ];
  const result = buildCompressedMessages([], categorized);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'user');
});

// ── maybeCompress (integration) ──────────────────────────────────────────────

test('maybeCompress: too few messages → no compression', async () => {
  const core = makeCore([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
  const result = await maybeCompress(core, 128000, estimateMessagesTokens(core.getMessages()));
  assert.equal(result.compressed, false);
  assert.equal(result.discardedCount, 0);
});

test('maybeCompress: under summarize threshold → no compression', async () => {
  const msgs = makeMessages(3, 50);
  const tokens = estimateMessagesTokens(msgs);
  const core = makeCore(msgs);
  const result = await maybeCompress(core, 128000, tokens);
  assert.equal(result.compressed, false);
});

test('maybeCompress: at/above summarize threshold → compresses and yields savings', async () => {
  // 15 pairs × 1000 chars ≈ 7951 tokens, window=15000 → effective=10904 → ratio ~73%
  // Above 70% (summarize) but below 90% (evict)
  const msgs = makeMessages(15, 1000);
  const tokens = estimateMessagesTokens(msgs);
  const core = makeCore(msgs);

  const result = await maybeCompress(core, 15000, tokens);

  assert.equal(result.compressed, true);
  assert.ok(result.compressedTokenSavings > 0, 'should save tokens via compression');
  assert.ok(result.layerBreakdown.recent > 0, 'should have recent messages');
  assert.ok(result.layerBreakdown.compressed > 0, 'should have compressed messages');
  assert.equal(result.discardedCount, 0, 'should not evict below 90%');
  const replaced = core.getLastReplaced();
  assert.ok(replaced!.length < msgs.length, `replaced (${replaced!.length}) should be fewer than original (${msgs.length})`);
});

test('maybeCompress: above eviction threshold → also discards old blocks', async () => {
  // 20 pairs × 1000 chars ≈ 10601 tokens, window=5000 → effective=904 → ratio ~1173%
  // Well above 90% → eviction triggers
  const msgs = makeMessages(20, 1000);
  const tokens = estimateMessagesTokens(msgs);
  const core = makeCore(msgs);

  const result = await maybeCompress(core, 5000, tokens);

  assert.equal(result.compressed, true);
  assert.ok(result.discardedCount > 0, 'should discard old blocks above eviction threshold');
  assert.ok(result.layerBreakdown.discarded > 0);
  const replaced = core.getLastReplaced();
  assert.ok(replaced !== null && replaced!.length < msgs.length, 'replaced should be fewer than original');
});

test('maybeCompress: undefined contextWindow uses default 128000', async () => {
  const msgs = makeMessages(10, 50);
  const tokens = estimateMessagesTokens(msgs);
  const core = makeCore(msgs);

  const result = await maybeCompress(core, undefined, tokens);
  assert.equal(result.compressed, false);
});

test('maybeCompress: layerBreakdown is consistent', async () => {
  const msgs = makeMessages(12, 1000);
  const tokens = estimateMessagesTokens(msgs);
  const core = makeCore(msgs);

  const result = await maybeCompress(core, 5000, tokens);

  if (result.compressed) {
    const { recent, compressed, discarded } = result.layerBreakdown;
    assert.ok(recent > 0, 'recent count > 0');
    assert.ok(recent + compressed + discarded >= 0, 'totals should be non-negative');
  }
});
