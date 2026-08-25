// ============================================================
// Agent 元认知 — 计算预算预测与校准。
//
// 开启 metacognition 后，Agent 在回答前先输出 COST_ESTIMATE
// （预测工具调用数 / token 消耗），run 结束后与实测对比写入
// cost_estimates 表；前端据此画校准曲线（预测 vs 实际）。
// 呼应 ACS 的 adaptive compute：模型是否知道自己该花多少计算。
// ============================================================

import { getDb } from '../db/database.js';

export interface CostEstimate {
  id: string;
  sessionId: string;
  model: string;
  predictedToolCalls: number | null;
  predictedTokens: number | null;
  actualToolCalls: number;
  actualTokens: number;
  createdAt: string;
}

/** 从模型响应文本中解析 COST_ESTIMATE（JSON 或 "N calls, M tokens" 形式）。 */
export function parseCostEstimate(text: string): { predictedToolCalls?: number; predictedTokens?: number } | null {
  if (!text) return null;
  // 形式 1：JSON（camelCase 与 snake_case 键）
  const jsonMatch = text.match(/\{[^{}]*"predicted(?:ToolCalls|_tool_calls|Tokens|_tokens)"[^{}]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const predictedToolCalls = obj.predictedToolCalls ?? obj.predicted_tool_calls ?? obj.toolCalls ?? obj.calls;
      const predictedTokens = obj.predictedTokens ?? obj.predicted_tokens ?? obj.tokens;
      if (typeof predictedToolCalls === 'number' || typeof predictedTokens === 'number') {
        return {
          predictedToolCalls: typeof predictedToolCalls === 'number' ? Math.max(0, Math.round(predictedToolCalls)) : undefined,
          predictedTokens: typeof predictedTokens === 'number' ? Math.max(0, Math.round(predictedTokens)) : undefined,
        };
      }
    } catch { /* fall through */ }
  }
  // 形式 2：COST_ESTIMATE: N calls, M tokens
  const calls = text.match(/COST_ESTIMATE[^0-9]{0,20}(\d+)\s*(?:tool|call|step)s?/i);
  const tokens = text.match(/(\d+)\s*(?:tokens?|tok)/i);
  const result: { predictedToolCalls?: number; predictedTokens?: number } = {};
  if (calls) result.predictedToolCalls = Number(calls[1]);
  if (tokens) result.predictedTokens = Number(tokens[1]);
  return Object.keys(result).length ? result : null;
}

export function saveCostEstimate(e: Omit<CostEstimate, 'id' | 'createdAt'>): void {
  try {
    const id = `ce-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    getDb()
      .prepare(
        `INSERT INTO cost_estimates (id, session_id, model, predicted_tool_calls, predicted_tokens, actual_tool_calls, actual_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        e.sessionId,
        e.model,
        e.predictedToolCalls ?? null,
        e.predictedTokens ?? null,
        e.actualToolCalls,
        e.actualTokens
      );
  } catch { /* best-effort telemetry */ }
}

export function listCostEstimates(sessionId?: string, limit = 100): CostEstimate[] {
  const rows = (sessionId
    ? getDb().prepare('SELECT * FROM cost_estimates WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit)
    : getDb().prepare('SELECT * FROM cost_estimates ORDER BY created_at DESC LIMIT ?').all(limit)) as any[];
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    model: r.model ?? '',
    predictedToolCalls: r.predicted_tool_calls,
    predictedTokens: r.predicted_tokens,
    actualToolCalls: r.actual_tool_calls,
    actualTokens: r.actual_tokens,
    createdAt: r.created_at,
  }));
}

/** 校准数据：按预测 token 分桶，对比桶内平均实际值。 */
export function calibrationBins(estimates: CostEstimate[]): { bin: string; predicted: number; actual: number; n: number }[] {
  const withTokens = estimates.filter((e) => e.predictedTokens != null && e.actualTokens > 0);
  if (!withTokens.length) return [];
  const maxP = Math.max(...withTokens.map((e) => e.predictedTokens ?? 0));
  const bucketSize = Math.max(1, Math.ceil(maxP / 4));
  const buckets = new Map<number, { predicted: number[]; actual: number[] }>();
  for (const e of withTokens) {
    const b = Math.floor((e.predictedTokens ?? 0) / bucketSize);
    if (!buckets.has(b)) buckets.set(b, { predicted: [], actual: [] });
    buckets.get(b)!.predicted.push(e.predictedTokens ?? 0);
    buckets.get(b)!.actual.push(e.actualTokens);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, v]) => ({
      bin: `${b * bucketSize}–${(b + 1) * bucketSize - 1}`,
      predicted: Math.round(v.predicted.reduce((a, c) => a + c, 0) / v.predicted.length),
      actual: Math.round(v.actual.reduce((a, c) => a + c, 0) / v.actual.length),
      n: v.actual.length,
    }));
}
