import express from 'express';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const voiceRouter = express.Router();

const TTS_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const TTS_API_KEY = process.env.OPENAI_API_KEY || '';

// Known OpenAI TTS voices
const KNOWN_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];

// List available TTS voices (tries API first, falls back to known list).
voiceRouter.get('/voices', async (_req, res) => {
  try {
    const { OpenAI } = await import('openai');
    const client = new OpenAI({ baseURL: TTS_BASE_URL, apiKey: TTS_API_KEY });
    // listVoices 是较新的 API，部分 SDK 类型/网关未提供——用带默认值的鸭子类型访问，缺失即回退
    const speech = client.audio.speech as { listVoices?: () => Promise<{ data: { voice: string }[] }> };
    if (!speech.listVoices) throw new Error('listVoices not supported by SDK');
    const resp = await speech.listVoices();
    res.json({
      voices: (resp.data || []).map((v) => ({ id: v.voice, name: v.voice, category: 'tts' as const })),
      source: 'api',
    });
  } catch (err) {
    logError(logger, 'voice:list-voices', err);
    // Fallback: return hardcoded OpenAI TTS voices
    res.json({
      voices: KNOWN_VOICES.map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), category: 'tts' as const })),
      source: 'fallback',
    });
  }
});

// Text → speech. Returns base64 audio (client plays it).
voiceRouter.post('/tts', async (req, res) => {
  const { text, voice = 'alloy', model = 'gpt-4o-mini-tts' } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const { OpenAI } = await import('openai');
    const client = new OpenAI({ baseURL: TTS_BASE_URL, apiKey: TTS_API_KEY });
    const resp = await client.audio.speech.create({ model, voice, input: text });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.json({ ok: true, audioBase64: buf.toString('base64'), format: 'mp3' });
  } catch (e: unknown) {
    logError(logger, 'voice:tts', e);
    res.status(500).json({ error: (e as Error).message || 'TTS failed' });
  }
});

// Speech → text. Accepts base64 audio.
voiceRouter.post('/stt', async (req, res) => {
  const { audioBase64, model = 'whisper-1' } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 required' });
  // 大小上限：base64 14MB ≈ 10MB 音频，防超大输入全量进内存
  if (typeof audioBase64 === 'string' && audioBase64.length > 14 * 1024 * 1024) {
    return res.status(413).json({ error: 'audioBase64 too large (max ~10 MB audio)' });
  }
  try {
    const { OpenAI } = await import('openai');
    const client = new OpenAI({ baseURL: TTS_BASE_URL, apiKey: TTS_API_KEY, timeout: 60000 });
    const buf = Buffer.from(audioBase64, 'base64');
    const file = new File([buf], 'audio.webm', { type: 'audio/webm' });
    const resp = await client.audio.transcriptions.create({ model, file });
    res.json({ ok: true, text: (resp as { text: string }).text });
  } catch (e: unknown) {
    logError(logger, 'voice:stt', e);
    res.status(500).json({ error: (e as Error).message || 'STT failed' });
  }
});
