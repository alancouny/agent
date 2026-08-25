/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { logError, safeErrorMessage } from '../../utils/error-mask.js';
import { logger } from '../../utils/logger.js';

export const modelsRouter = Router();

// Test OpenAI-compatible connection
modelsRouter.post('/test-openai', async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body;
    const { OpenAI } = await import('openai');
    const client = new OpenAI({
      baseURL: baseUrl || 'https://api.openai.com/v1',
      apiKey: apiKey || 'dummy',
    });
    const resp = await client.chat.completions.create({
      model: model || 'gpt-4o',
      messages: [{ role: 'user', content: 'OK' }],
      max_tokens: 5,
    });
    res.json({ ok: true, message: `Connected to ${model || 'model'}`, data: resp.choices?.[0]?.message?.content });
  } catch (err: unknown) {
    logError(logger, 'test-openai', err);
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Connection failed');
    res.json({ ok: false, message });
  }
});

// Test Anthropic connection
modelsRouter.post('/test-anthropic', async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body;
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey,
      baseURL: (baseUrl || 'https://api.anthropic.com').replace(/\/v1$/, ''),
    });
    const resp = await client.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'OK' }] }],
      max_tokens: 5,
    });
    res.json({ ok: true, message: `Connected to ${model || 'model'}`, data: (resp.content[0] as { type?: string; text?: string })?.text });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Connection failed');
    res.json({ ok: false, message });
  }
});

// ── Model comparison: send the same prompt to several models, return all answers ──
modelsRouter.post('/compare', async (req, res) => {
  const { message, targets } = req.body || {};
  if (!message || !Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: 'message and non-empty targets[] required' });
  }
  const results = await Promise.all(
    targets.map(async (t: Record<string, unknown>) => {
      try {
        const text = await singleCompletion(t as Record<string, string>, message);
        return { provider: t.provider as string, model: t.model as string, ok: true, text };
      } catch (e: unknown) {
        // 错误响应体脱敏（AC-R3-2）：/compare 的 error 字段同样会回传客户端
        return { provider: t.provider as string, model: t.model as string, ok: false, error: safeErrorMessage(e) };
      }
    })
  );
  res.json({ results });
});

// Single (no-tools) completion against a given provider/model — used by /compare.
async function singleCompletion(t: any, message: string): Promise<string> {
  const provider = (t.provider || 'openai').toLowerCase();
  const model = t.model;
  const baseUrl = t.baseUrl;
  const apiKey = t.apiKey;
  if (provider === 'anthropic') {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, baseURL: (baseUrl || 'https://api.anthropic.com').replace(/\/v1$/, '') });
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    });
    return (resp.content[0] as { type?: string; text?: string })?.text || '';
  }
  const { OpenAI } = await import('openai');
  const client = new OpenAI({ baseURL: baseUrl || 'https://api.openai.com/v1', apiKey: apiKey || 'dummy' });
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: message }],
    max_tokens: 1024,
  });
  return resp.choices?.[0]?.message?.content || '';
}
