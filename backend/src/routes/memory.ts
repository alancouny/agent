// 全局长期记忆 API：
//   GET    /api/memory/providers            — 全部来源 + available + active
//   POST   /api/memory/providers/:id/activate  {active} 切换激活
//   GET    /api/memory/search?q=&topK=      — 跨 active 源合并检索
//   GET    /api/memory?provider=&limit=     — 列表（默认 active 全部）
//   POST   /api/memory                      新增
//   PATCH  /api/memory/:id                  更新
//   DELETE /api/memory/:id                  删除
import { Router } from 'express';
import { safeErrorMessage } from '../utils/error-mask.js';
import {
  listMemoryProviders,
  getMemoryProvider,
  isMemoryProviderActive,
  setMemoryProviderActive,
  searchAllMemories,
  activeMemoryProviderIds,
} from '../memory/registry.js';

export const memoryRouter = Router();

memoryRouter.get('/providers', async (_req, res) => {
  const providers = await Promise.all(
    listMemoryProviders().map(async (p) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      available: await p.isAvailable(),
      active: isMemoryProviderActive(p.id),
    }))
  );
  res.json({ providers });
});

memoryRouter.post('/providers/:id/activate', async (req, res) => {
  const { active } = req.body || {};
  const ok = await setMemoryProviderActive(req.params.id, Boolean(active));
  if (!ok) return res.status(400).json({ error: 'provider not found or unavailable' });
  res.json({ ok: true, activeIds: activeMemoryProviderIds() });
});

memoryRouter.get('/lessons', async (_req, res) => {
  const p = getMemoryProvider('local');
  if (!p) return res.status(404).json({ error: 'provider not found' });
  const entries = await p.list(500);
  const lessons = entries.filter((e) => (e.tags ?? []).includes('lesson'));
  res.json({ lessons, count: lessons.length });
});

memoryRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'q is required' });
  const topK = Math.min(Number(req.query.topK) || 5, 20);
  const results = await searchAllMemories(q, topK);
  res.json({ results, count: results.length, sources: activeMemoryProviderIds() });
});

memoryRouter.get('/', async (req, res) => {
  const providerId = typeof req.query.provider === 'string' ? req.query.provider : undefined;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  if (providerId) {
    const p = getMemoryProvider(providerId);
    if (!p) return res.status(404).json({ error: 'provider not found' });
    return res.json({ entries: await p.list(limit), provider: providerId });
  }
  // 默认：active 源合并（按更新时间）
  const entries = await Promise.all(
    activeMemoryProviderIds().map(async (id) => {
      const p = getMemoryProvider(id);
      if (!p || !(await p.isAvailable())) return [];
      return (await p.list(Math.ceil(limit / 2))).map((e) => ({ ...e, providerId: id }));
    })
  );
  const merged = entries.flat().sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1)).slice(0, limit);
  res.json({ entries: merged, sources: activeMemoryProviderIds() });
});

memoryRouter.post('/', async (req, res) => {
  const { content, tags, provider } = req.body || {};
  const p = getMemoryProvider(provider || 'local');
  if (!p) return res.status(404).json({ error: 'provider not found' });
  try {
    const entry = await p.add({ content: String(content ?? ''), tags: Array.isArray(tags) ? tags.map(String) : undefined });
    res.json({ entry });
  } catch (e: any) {
    // 错误响应体脱敏（AC-R3-2）
    res.status(400).json({ error: safeErrorMessage(e.message || 'add failed') });
  }
});

memoryRouter.patch('/:id', async (req, res) => {
  const { content, tags } = req.body || {};
  // 更新 local（MCP 只读来源返回 501）
  const p = getMemoryProvider('local');
  if (!p) return res.status(404).json({ error: 'provider not found' });
  const entry = await p.update(req.params.id, {
    content: typeof content === 'string' ? content : undefined,
    tags: Array.isArray(tags) ? tags.map(String) : undefined,
  });
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ entry });
});

memoryRouter.delete('/:id', async (req, res) => {
  const p = getMemoryProvider('local');
  if (!p) return res.status(404).json({ error: 'provider not found' });
  const ok = await p.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'entry not found' });
  res.json({ ok: true });
});
