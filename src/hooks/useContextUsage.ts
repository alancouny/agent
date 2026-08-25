import { useCallback, useRef, useState } from 'react';
import { agentApi, modelProviderApi } from '../api/client';
import type { ContextUsage, Message } from '../types';

/**
 * 上下文窗口使用情况 hook。
 *
 * 数据来源（三层，按优先级）：
 *  1. live —— 流式 SSE 事件里的 usage（后端已归一化 camelCase 并附带 contextWindow）
 *  2. restored —— 会话恢复时 GET /api/agent/tokens 的累计用量 + 消息级 token 估算
 *  3. estimated —— 后端不返回 usage（部分本地/网关模型）时，用字符级估算兜底
 *
 * 计算方式：
 *  contextUsed  = promptTokens + completionTokens（最近一次 LLM 调用实际发送/生成的上下文）
 *  percent      = contextUsed / contextWindow * 100
 *  cumulative   = usage_log 表按 session_id 的 SUM(prompt|completion|total)
 */
const FALLBACK_WINDOWS: Array<[string, number]> = [
  ['gemini', 1_000_000],
  ['claude', 200_000],
  ['gpt-', 128_000],
  ['deepseek', 128_000],
  ['qwen', 128_000],
  ['llama', 128_000],
  ['mistral', 32_000],
];
const DEFAULT_WINDOW = 128_000;
const SYSTEM_OVERHEAD_TOKENS = 300;

/** 字符级 token 估算：CJK 字符 ≈ 1 token，其余 ≈ 4 字符 1 token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isCJK =
      (code >= 0x2e80 && code <= 0x9fff) || // CJK 部首/统一表意文字
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
      (code >= 0xff00 && code <= 0xffef); // 全角形式
    if (isCJK) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/** 按消息数组估算“模型实际看到的上下文”tokens（含系统提示词开销）。 */
export function estimateContextTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content ?? '');
  return total + SYSTEM_OVERHEAD_TOKENS;
}

function emptyUsage(): ContextUsage {
  return {
    contextUsed: 0,
    contextPrompt: 0,
    contextCompletion: 0,
    contextWindow: 0,
    percent: 0,
    cumulative: { total: 0, prompt: 0, completion: 0 },
    source: 'none',
  };
}

export function useContextUsage() {
  const [usage, setUsage] = useState<ContextUsage>(emptyUsage);
  // 始终持有“最近已知的窗口容量”，供异步恢复/估算流程读取最新值
  const windowRef = useRef(0);
  // 模型目录缓存：provider -> modelId -> contextWindow
  const catalogRef = useRef<Record<string, Record<string, number>> | null>(null);

  const loadCatalog = useCallback(async (): Promise<Record<string, Record<string, number>>> => {
    if (catalogRef.current) return catalogRef.current;
    const map: Record<string, Record<string, number>> = {};
    try {
      const res = await modelProviderApi.getProviders();
      for (const p of res.providers ?? []) {
        map[p.id] = {};
        for (const m of p.models ?? []) {
          if (m.contextWindow) map[p.id][m.id] = m.contextWindow;
        }
      }
    } catch {
      /* 后端不可用时回退到内置表 */
    }
    catalogRef.current = map;
    return map;
  }, []);

  /** 解析模型上下文窗口：目录精确匹配 → 前缀/包含匹配 → 内置碎片表 → 默认值。 */
  const resolveWindow = useCallback(
    async (provider: string, model: string): Promise<number> => {
      if (!model) return 0;
      const catalog = await loadCatalog();
      const byProvider = catalog[provider];
      if (byProvider) {
        if (byProvider[model]) return byProvider[model];
        for (const [k, v] of Object.entries(byProvider)) {
          if (model.startsWith(k) || model.includes(k) || k.startsWith(model)) return v;
        }
      }
      const lower = model.toLowerCase();
      for (const [frag, win] of FALLBACK_WINDOWS) {
        if (lower.includes(frag)) return win;
      }
      return DEFAULT_WINDOW;
    },
    [loadCatalog]
  );

  /** 切换模型时更新窗口容量（异步解析，返回后自动更新状态）。 */
  const setModel = useCallback(
    async (provider: string, model: string) => {
      if (!model) return;
      const win = await resolveWindow(provider, model);
      if (win) windowRef.current = win;
      setUsage((prev) => ({ ...prev, contextWindow: win || prev.contextWindow }));
    },
    [resolveWindow]
  );

  /** 流式消费后端 usage 事件（每完成一次 LLM 调用触发一次，多步 Agent 会持续增长）。 */
  const consumeUsage = useCallback(
    (u?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; contextWindow?: number } | null) => {
      if (!u) return;
      const prompt = u.promptTokens ?? 0;
      const completion = u.completionTokens ?? 0;
      const total = u.totalTokens ?? prompt + completion;
      if (total <= 0) return;
      if (u.contextWindow) windowRef.current = u.contextWindow;
      const win = u.contextWindow || windowRef.current || 0;
      setUsage((prev) => ({
        contextUsed: total,
        contextPrompt: prompt,
        contextCompletion: completion,
        contextWindow: win,
        percent: win > 0 ? Math.min(100, (total / win) * 100) : 0,
        cumulative: prev.cumulative,
        source: 'live',
      }));
    },
    []
  );

  /** 新会话 / 清空聊天：归零展示状态（保留已知窗口容量，供下一次 setModel 前兜底）。 */
  const reset = useCallback(() => {
    setUsage(() => ({ ...emptyUsage(), contextWindow: windowRef.current }));
  }, []);

  /** 会话恢复：拉取 usage_log 累计用量，并用消息估算当前上下文占用。 */
  const restore = useCallback(async (sessionId: string, msgs: Message[]) => {
    if (!sessionId) return;
    let cumulative = { total: 0, prompt: 0, completion: 0 };
    try {
      const res = await agentApi.tokens(sessionId);
      cumulative = {
        total: res.tokens?.total ?? 0,
        prompt: res.tokens?.prompt ?? 0,
        completion: res.tokens?.completion ?? 0,
      };
    } catch {
      /* 后端不可用：仅展示估算值 */
    }
    const estimated = estimateContextTokens(msgs);
    const win = windowRef.current;
    setUsage((prev) => ({
      contextUsed: estimated,
      contextPrompt: 0,
      contextCompletion: 0,
      contextWindow: win || prev.contextWindow,
      percent: win > 0 ? Math.min(100, (estimated / win) * 100) : 0,
      cumulative,
      source: estimated > 0 ? 'restored' : 'none',
    }));
  }, []);

  return { usage, consumeUsage, setModel, restore, reset };
}
