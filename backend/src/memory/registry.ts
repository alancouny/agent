// 记忆 Provider 注册表：多源注册 + 多选激活 + 统一检索合并。
import type { MemoryEntry, MemoryProvider, RankedMemory } from './types.js';

const providers = new Map<string, MemoryProvider>();
const activeIds = new Set<string>(['local']);

export function registerMemoryProvider(p: MemoryProvider): void {
  providers.set(p.id, p);
}

export function getMemoryProvider(id: string): MemoryProvider | undefined {
  return providers.get(id);
}

export function listMemoryProviders(): MemoryProvider[] {
  return [...providers.values()];
}

export function isMemoryProviderActive(id: string): boolean {
  return activeIds.has(id);
}

export async function setMemoryProviderActive(id: string, on: boolean): Promise<boolean> {
  const p = providers.get(id);
  if (!p) return false;
  if (!on) {
    activeIds.delete(id);
    // local 至少保留一个 active（避免无源可用）
    if (activeIds.size === 0) activeIds.add('local');
    return true;
  }
  if (!(await p.isAvailable())) return false;
  activeIds.add(id);
  return true;
}

/** 跨 active 源并发检索并按 score 归并排序（无缝集成多来源）。 */
export async function searchAllMemories(query: string, topK = 5): Promise<RankedMemory[]> {
  const results = await Promise.allSettled(
    [...activeIds].map(async (id) => {
      const p = providers.get(id);
      if (!p || !(await p.isAvailable())) return [] as RankedMemory[];
      const hits = await p.search(query, topK * 2);
      return hits.map((h) => ({ ...h, providerId: id })) as RankedMemory[];
    })
  );
  const merged: RankedMemory[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value);
  }
  return merged
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(1, Math.min(topK, 20)));
}

/** 列出 active 源（用于面板展示当前生效来源）。 */
export function activeMemoryProviderIds(): string[] {
  return [...activeIds];
}

export type { MemoryEntry, MemoryProvider };
