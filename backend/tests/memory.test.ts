import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getDb } from '../src/db/database.js';
import { localMemoryProvider } from '../src/memory/local.js';
import { invalidateMemoryCache, searchCandidateIds } from '../src/memory/fts.js';
import { createMcpMemoryProvider } from '../src/memory/mcp.js';
import {
  registerMemoryProvider,
  setMemoryProviderActive,
  searchAllMemories,
  activeMemoryProviderIds,
  isMemoryProviderActive,
} from '../src/memory/registry.js';
import { toolRegistry } from '../src/tools/registry.js';
import { memoryRouter } from '../src/routes/memory.js';

let server: any;
let base: string;

test.before(async () => {
  // 清理旧数据，保证测试隔离
  getDb().prepare('DELETE FROM global_memories').run();
  registerMemoryProvider(localMemoryProvider);
  // 模拟 server.ts 启动时的默认 MCP 笔记源（自动发现模式）
  registerMemoryProvider(createMcpMemoryProvider('mcp:notes', 'MCP Notes (Obsidian/Notion)'));
  const app = express();
  app.use(express.json());
  app.use('/api/memory', memoryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as any).port}/api`;
});

test.after(() => server?.close());

// ── local provider ──
test('local: add / list / update / remove roundtrip', async () => {
  const e = await localMemoryProvider.add({ content: 'user prefers Python for research scripts', tags: ['preference'] });
  assert.ok(e.id);
  const list = await localMemoryProvider.list();
  assert.ok(list.some((x) => x.id === e.id));

  const updated = await localMemoryProvider.update(e.id, { content: 'user prefers Python and Rust' });
  assert.equal(updated?.content, 'user prefers Python and Rust');
  assert.equal(updated?.tags?.[0], 'preference');

  const removed = await localMemoryProvider.remove(e.id);
  assert.equal(removed, true);
  assert.equal(await localMemoryProvider.get(e.id), null);
});

test('local: search ranks by keyword overlap', async () => {
  await localMemoryProvider.add({ content: 'ACS model uses adaptive compute states', tags: ['research', 'acs'] });
  await localMemoryProvider.add({ content: '今天下午三点开会', tags: [] });
  const hits = await localMemoryProvider.search('ACS compute', 5);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].score, Math.max(...hits.map((h) => h.score ?? 0)), 'best match first');
});

// ── registry / switch ──
test('registry: mcp provider availability depends on registered tools', async () => {
  const p = createMcpMemoryProvider('mcp:test-notes', 'Test Notes');
  assert.equal(await p.isAvailable(), false);
  registerMemoryProvider(p);
  // 注册一个模拟 Obsidian 搜索工具后应可用
  toolRegistry.register('mcp:test-notes:search_notes', {
    schema: { name: 'mcp:test-notes:search_notes', description: 'Search notes', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    handler: async () => ({ success: true, output: JSON.stringify([{ id: 'n1', content: 'project decision: use sqlite-vec' }]) }),
    category: 'mcp',
    requiresApproval: false,
    enabled: true,
    readOnly: true,
  });
  assert.equal(await p.isAvailable(), true);
  const hits = await p.search('sqlite', 3);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].content, 'project decision: use sqlite-vec');
});

test('registry: activate switch and merged search', async () => {
  // 恢复默认 active = local
  await setMemoryProviderActive('local', true);
  assert.ok(isMemoryProviderActive('local'));
  const merged = await searchAllMemories('ACS', 5);
  assert.ok(merged.length >= 1);
  assert.ok(merged.every((m) => m.providerId));
});

// ── HTTP ──
test('memory: POST / add + GET / search via HTTP', async () => {
  const add = await fetch(`${base}/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'API test memory entry', tags: ['http'] }),
  });
  assert.equal(add.status, 200);
  const { entry } = await add.json();
  assert.ok(entry.id);

  const search = await fetch(`${base}/memory/search?q=API+test&topK=3`);
  assert.equal(search.status, 200);
  const { results, count } = await search.json();
  assert.ok(count >= 1);
  assert.ok(results.some((r: any) => r.content.includes('API test memory entry')));

  // providers 列表包含 local + mcp:notes
  const providers = await (await fetch(`${base}/memory/providers`)).json();
  const ids = providers.providers.map((p: any) => p.id);
  assert.ok(ids.includes('local'));
  assert.ok(ids.includes('mcp:notes'));
});

test('memory: activate endpoint validates provider', async () => {
  const res = await fetch(`${base}/memory/providers/nope/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true }),
  });
  assert.equal(res.status, 400);
});

// ── R2：FTS5 预筛 + TTL 缓存 ──

test('memory: FTS indexes stay in sync with global_memories (insert/update/delete)', async () => {
  const db = getDb();
  const countFts = () => (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts').get() as any).c;
  const countTri = () => (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts_trigram').get() as any).c;
  const before = countFts();
  assert.equal(countTri(), before);

  const e = await localMemoryProvider.add({ content: 'sync probe oldtokenzzz', tags: ['probe'] });
  assert.equal(countFts(), before + 1);
  assert.equal(countTri(), before + 1);

  await localMemoryProvider.update(e.id, { content: 'sync probe newtokenqqq', tags: ['probe2'] });
  assert.equal(countFts(), before + 1);
  assert.equal(countTri(), before + 1);

  // 更新后旧内容不再可检索、新内容可检索（验证 UPDATE 触发器 delete+insert 正确性）
  const oldHit = await localMemoryProvider.search('oldtokenzzz', 5);
  assert.ok(!oldHit.some((h) => h.id === e.id));
  const newHit = await localMemoryProvider.search('newtokenqqq', 5);
  assert.ok(newHit.some((h) => h.id === e.id));

  await localMemoryProvider.remove(e.id);
  assert.equal(countFts(), before);
  assert.equal(countTri(), before);
});

test('memory: searchCandidateIds prefilter recalls EN words / tags / Chinese ≥3 chars', async () => {
  await localMemoryProvider.add({ content: 'user loves hiking on weekends', tags: ['hobby'] });
  await localMemoryProvider.add({ content: '今天下午三点开会讨论产品路线图', tags: [] });
  await localMemoryProvider.add({ content: 'project acs planning meeting', tags: ['acs'] });

  // unicode61 英文词预筛
  const enIds = searchCandidateIds('hiking');
  assert.ok(enIds.length >= 1);
  const en = await localMemoryProvider.search('hiking', 5);
  assert.ok(en.some((h) => h.content.includes('hiking on weekends')));

  // unicode61 标签预筛（planning 仅在该行 content）
  const tag = await localMemoryProvider.search('planning', 5);
  assert.ok(tag.some((h) => h.content.includes('acs planning')));

  // trigram 中文 ≥3 字预筛
  const zhIds = searchCandidateIds('今天下午三点');
  assert.ok(zhIds.length >= 1);
  const zh = await localMemoryProvider.search('今天下午三点', 5);
  assert.ok(zh.some((h) => h.content.includes('今天下午三点开会')));

  const zh2 = await localMemoryProvider.search('产品路线图', 5);
  assert.ok(zh2.some((h) => h.content.includes('产品路线图')));
});

test('memory: 2-char Chinese query falls back to LIKE prefilter', async () => {
  await localMemoryProvider.add({ content: '讨论预算与成本控制', tags: [] });
  const hits = await localMemoryProvider.search('预算', 5);
  assert.ok(hits.some((h) => h.content.includes('预算')));
});

test('memory: multi-segment CJK query recalls by segment union (AC-R2-2 regression)', async () => {
  // 回归：多个独立 CJK 段（"开源 项目"）不能 join 成连续串 "开源项目" 走 trigram
  //（内容含 "开源"+"项目" 但无连续子串时漏召回）；应按段分别预筛取并集。
  await localMemoryProvider.add({ content: '开源社区项目今天完成', tags: [] });
  const hits = await localMemoryProvider.search('开源 项目', 5);
  assert.ok(hits.some((h) => h.content.includes('开源社区项目今天完成')));

  // 混合段：3 字段（trigram）+ 2 字段（LIKE）并集
  await localMemoryProvider.add({ content: '季度预算评审在周五进行', tags: [] });
  const hits2 = await localMemoryProvider.search('季度预算 周五', 5);
  assert.ok(hits2.some((h) => h.content.includes('季度预算评审在周五进行')));
});

test('memory: TTL cache hit returns cached results; invalidation clears', async () => {
  const e = await localMemoryProvider.add({ content: 'alpha beta cacheprobe token', tags: [] });
  const first = await localMemoryProvider.search('cacheprobe', 5);
  assert.ok(first.some((h) => h.id === e.id));

  // 直接 SQL 删除（绕过 provider.remove → 不触发缓存失效）：
  // TTL 内第二次检索应命中缓存，仍返回旧结果（允许短暂脏读，AC-R2-3）
  getDb().prepare('DELETE FROM global_memories WHERE id = ?').run(e.id);
  const second = await localMemoryProvider.search('cacheprobe', 5);
  assert.ok(second.some((h) => h.id === e.id), 'TTL 内重复检索应命中缓存');

  // 显式失效后，FTS 索引已同步删除 → 查询为空
  invalidateMemoryCache();
  const third = await localMemoryProvider.search('cacheprobe', 5);
  assert.equal(third.length, 0);
});

test('memory: add / update / remove invalidate the TTL cache', async () => {
  const a = await localMemoryProvider.add({ content: 'gamma delta shared-token', tags: [] });
  const r1 = await localMemoryProvider.search('shared-token', 5);
  assert.equal(r1.length, 1);

  // add 后缓存失效 → 再次检索能看到新增记忆
  const b = await localMemoryProvider.add({ content: 'gamma delta shared-token', tags: [] });
  const r2 = await localMemoryProvider.search('shared-token', 5);
  assert.equal(r2.length, 2);

  // update 后缓存失效 → 旧内容不再命中
  await localMemoryProvider.update(a.id, { content: 'completely different content' });
  const r3 = await localMemoryProvider.search('shared-token', 5);
  assert.equal(r3.length, 1);

  // remove 后缓存失效 → 被删记忆不再返回
  await localMemoryProvider.remove(b.id);
  const r4 = await localMemoryProvider.search('shared-token', 5);
  assert.equal(r4.length, 0);
});

test('memory: key hit preserved in topK after FTS prefilter (semantic equivalence)', async () => {
  await localMemoryProvider.add({ content: 'quarterly budget planning for acme corp', tags: ['finance', 'planning'] });
  await localMemoryProvider.add({ content: 'user prefers concise answers and dark theme', tags: ['preference'] });

  const hits = await localMemoryProvider.search('acme budget', 5);
  assert.ok(hits.some((h) => h.content.includes('acme corp')));

  const tagHits = await localMemoryProvider.search('finance', 5);
  assert.ok(tagHits.some((h) => h.tags?.includes('finance')));
});

test('memory: 1000+ rows smoke — FTS prefilter keeps search correct and fast', async () => {
  const db = getDb();
  const ins = db.prepare(
    'INSERT INTO global_memories (id, content, tags, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  const addRows = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      ins.run(`mem-bulk-${i}`, `bulk memory entry number ${i} with filler text`, '[]', 'local', now, now);
    }
  });
  addRows(1100);

  const mainCount = (db.prepare('SELECT COUNT(*) AS c FROM global_memories').get() as any).c;
  const ftsCount = (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts').get() as any).c;
  const triCount = (db.prepare('SELECT COUNT(*) AS c FROM global_memories_fts_trigram').get() as any).c;
  assert.equal(ftsCount, mainCount);
  assert.equal(triCount, mainCount);

  // LIMIT 预筛对"命中过多的高频词"（如 bulk 命中全部 1100 行）天然截断，属设计内例外；
  // 冒烟用例用唯一 token 验证 FTS 路径在千级数据上的正确性与速度。
  const start = Date.now();
  const hits = await localMemoryProvider.search('1042', 5);
  const elapsed = Date.now() - start;
  assert.ok(hits.some((h) => h.content.includes('number 1042')));
  assert.ok(elapsed < 2000, `search over 1100 rows took ${elapsed}ms (should be well under 2s)`);
});
