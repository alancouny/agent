// ============================================================
// Experiment Lab — 同一 prompt × 多组「模型/系统提示/温度」配置
// 并行运行的结构化对比（研究 agent 行为差异 / 架构对比的实用工具）。
//
//   POST /api/experiments/run
//   { prompt, runs: [{ label, model, provider?, baseUrl?, apiKey?,
//                      systemPrompt?, temperature?, maxTokens? }], maxIterations? }
//
// 每个 run 复用 AgentCore 完整跑一轮（含工具循环），统计：
// 耗时 / prompt·completion token / 工具调用次数 / 最终输出 / 错误。
// ============================================================

import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { v4 as uuidv4 } from 'uuid';
import { AgentCore } from '../agent/core.js';
import { getModelContextWindow } from './model_provider.js';

export const experimentsRouter = Router();

const MAX_RUNS = 6;
const MAX_PROMPT_LEN = 20_000;
const MAX_ITERATIONS = 30;

interface RunConfig {
  label: string;
  model: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ExperimentRunResult {
  label: string;
  model: string;
  ok: boolean;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls: number;
  output: string;
  error: string | null;
  /** 行为指纹：工具使用分布（雷达图数据源）。 */
  fingerprint: { toolUsage: Record<string, number>; toolDiversity: number };
}

async function runOnce(r: RunConfig, prompt: string, maxIterations: number): Promise<ExperimentRunResult> {
  const provider = r.provider || 'openai';
  const model = r.model || 'gpt-4o';
  const config = {
    provider,
    model,
    baseUrl: r.baseUrl || process.env.OPENAI_BASE_URL || undefined,
    apiKey: r.apiKey || process.env.OPENAI_API_KEY || undefined,
    maxIterations,
    maxTokens: r.maxTokens || 4096,
    temperature: r.temperature ?? 0.7,
    systemPrompt: r.systemPrompt || '', // 空字符串时 AgentCore 用默认系统提示
    contextWindow: getModelContextWindow(provider, model),
  };

  const agent = new AgentCore(config, `exp-${uuidv4()}`);
  let output = '';
  let toolCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let error: string | null = null;
  const toolUsage: Record<string, number> = {};

  const t0 = performance.now();
  try {
    for await (const ev of agent.run(prompt)) {
      if (ev.type === 'text') {
        output += ev.content;
        if (ev.usage) {
          promptTokens += ev.usage.promptTokens ?? 0;
          completionTokens += ev.usage.completionTokens ?? 0;
        }
      } else if (ev.type === 'tool_result') {
        toolCalls += 1;
        const name = (ev as any).toolResult?.name ?? 'unknown';
        toolUsage[name] = (toolUsage[name] ?? 0) + 1;
      } else if (ev.type === 'error' && error === null) {
        error = ev.error ?? null;
      }
    }
  } catch (e: any) {
    error = error ?? e?.message ?? String(e);
  }
  const durationMs = Math.round(performance.now() - t0);
  return {
    label: r.label,
    model,
    ok: error === null,
    durationMs,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    toolCalls,
    output: output.slice(0, 8000),
    error,
    fingerprint: { toolUsage, toolDiversity: Object.keys(toolUsage).length },
  };
}

experimentsRouter.post('/run', async (req, res) => {
  const { prompt, runs, maxIterations } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    return res.status(400).json({ error: `prompt too long (max ${MAX_PROMPT_LEN})` });
  }
  if (!Array.isArray(runs) || runs.length === 0) {
    return res.status(400).json({ error: 'runs must be a non-empty array' });
  }
  if (runs.length > MAX_RUNS) {
    return res.status(400).json({ error: `at most ${MAX_RUNS} runs per experiment` });
  }
  const cleanRuns: RunConfig[] = runs.map((r: any) => ({
    label: String(r?.label || '').trim(),
    model: String(r?.model || 'gpt-4o'),
    provider: r?.provider || undefined,
    baseUrl: r?.baseUrl || undefined,
    apiKey: r?.apiKey || undefined,
    systemPrompt: typeof r?.systemPrompt === 'string' ? r.systemPrompt : undefined,
    temperature: typeof r?.temperature === 'number' ? r.temperature : undefined,
    maxTokens: typeof r?.maxTokens === 'number' ? r.maxTokens : undefined,
  }));
  if (cleanRuns.some((r) => !r.label)) {
    return res.status(400).json({ error: 'every run needs a label' });
  }

  const iters = Math.min(Number(maxIterations) || 15, MAX_ITERATIONS);
  const t0 = performance.now();
  // 并行执行；单个 run 失败不影响其他（runOnce 内部已兜底）
  const results = await Promise.all(cleanRuns.map((r) => runOnce(r, prompt, iters)));
  const wallMs = Math.round(performance.now() - t0);

  const okRuns = results.filter((r) => r.ok);
  const quickest = okRuns.length ? okRuns.reduce((a, b) => (a.durationMs <= b.durationMs ? a : b)) : null;
  const cheapest = okRuns.length ? okRuns.reduce((a, b) => (a.totalTokens <= b.totalTokens ? a : b)) : null;
  const fewestCalls = okRuns.length ? okRuns.reduce((a, b) => (a.toolCalls <= b.toolCalls ? a : b)) : null;

  res.json({
    prompt,
    wallMs,
    runs: results,
    winners: {
      quickest: quickest?.label ?? null,
      cheapest: cheapest?.label ?? null,
      fewestCalls: fewestCalls?.label ?? null,
    },
  });
});
