// 经验回放（教训库）— 把 agent 的失败自动蒸馏为长期记忆中的"教训"，
// 后续相似任务经 memory_search / 注入自然复用（持续学习的 replay 机制实例化）。
import { localMemoryProvider } from './local.js';

/** 把一次 run 的失败摘要蒸馏为一条教训写入长期记忆（fire-and-forget）。 */
export async function recordLesson(sessionId: string, notes: string[]): Promise<void> {
  if (!notes.length) return;
  try {
    const content = [
      'LESSON (from agent failure):',
      ...notes.map((n, i) => `${i + 1}. ${n}`),
      'Reuse: when facing a similar task, avoid repeating these mistakes.',
    ].join('\n');
    await localMemoryProvider.add({
      content,
      tags: ['lesson', 'replay'],
    });
  } catch { /* best-effort */ }
}
