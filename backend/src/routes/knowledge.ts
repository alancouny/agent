import express from 'express';
import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';
import {
  ingestDocument,
  search,
  listDocs,
  deleteDoc,
  docCount,
  getConfig,
  updateConfig,
  rebuildIndex,
  indexStatus,
  effectiveBackend,
  syncIndex,
} from '../knowledge/store.js';
import type { ChunkStrategy, RetrievalMode, IndexBackend } from '../knowledge/store.js';

export const knowledgeRouter = express.Router();

/** 单次 ingest 的文本大小上限（防超大文本切出上千 chunk 一次 embed）。 */
const MAX_INGEST_TEXT = 2 * 1024 * 1024;

/** 粗略判定 IPv4/IPv6 是否指向内网/链路本地（SSRF 防护用）。 */
function isPrivateAddress(ip: string): boolean {
  if (ip === '::1' || ip === '0.0.0.0' || ip === '::') return true;
  const v4 = ip.includes('.') ? ip.split('.').map(Number) : [];
  if (v4.length === 4) {
    if (v4[0] === 127) return true; // 127.0.0.0/8
    if (v4[0] === 10) return true; // 10.0.0.0/8
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return true; // 172.16/12
    if (v4[0] === 192 && v4[1] === 168) return true; // 192.168/16
    if (v4[0] === 169 && v4[1] === 254) return true; // 链路本地
  }
  // IPv6：链路本地 fe80::/10、ULA fc00::/7、环回 ::1 已处理
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

/** 校验 URL 可被安全抓取：仅 http(s)、host 非 localhost、解析后非内网地址。 */
async function assertSafeFetchUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local/internal hosts are not allowed');
  }
  let address = host;
  try {
    ({ address } = await lookup(host));
  } catch {
    throw new Error(`Cannot resolve host: ${host}`);
  }
  if (isPrivateAddress(address)) {
    throw new Error('Private/loopback addresses are not allowed');
  }
}

/** Keep the native vec table in sync when sqlite-vec is the active backend (cheap no-op otherwise). */
function syncVecIfActive(): void {
  try {
    if (effectiveBackend() === 'sqlitevec') syncIndex();
  } catch {
    /* vec sync is best-effort */
  }
}

// ── Async ingestion queue (industrial pattern: ingestion is off the request path) ──
interface IngestJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  title: string;
  progress: number; // 0..1
  chunks: number;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
const ingestJobs = new Map<string, IngestJob>();

async function runIngestJob(job: IngestJob, text: string, title: string, source?: string): Promise<void> {
  job.status = 'running';
  try {
    const result = await ingestDocument({ title, source, text });
    job.chunks = result.chunks;
    job.progress = 1;
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    syncVecIfActive();
  } catch (err: unknown) {
    logError(logger, 'knowledge:ingest-job', err);
    // 异步任务错误会经 GET /ingest/jobs 回传客户端，同样脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Ingest failed');
    job.status = 'failed';
    job.error = message;
    job.finishedAt = new Date().toISOString();
  }
}

/** Ingest raw text or a URL into the knowledge base (sync path, small docs). */
knowledgeRouter.post('/ingest', async (req, res) => {
  try {
    const { title, text, url, async: asAsync } = req.body || {};

    const extractUrl = async (u: string): Promise<{ text: string; source: string }> => {
      await assertSafeFetchUrl(u); // SSRF 防护：禁私网/环回/非 http(s)
      const resp = await axios.get(u, { timeout: 15000, responseType: 'text', maxRedirects: 5 });
      const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
      const plain = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { text: plain, source: u };
    };

    if (url) {
      const { text: plain, source } = await extractUrl(url);
      if (plain.length > MAX_INGEST_TEXT) {
        return res.status(413).json({ error: `Extracted text too large (max ${Math.floor(MAX_INGEST_TEXT / 1024 / 1024)} MB)` });
      }
      if (asAsync) {
        const job: IngestJob = {
          id: uuidv4(), status: 'queued', title: title || url, progress: 0, chunks: 0, createdAt: new Date().toISOString(),
        };
        ingestJobs.set(job.id, job);
        void runIngestJob(job, plain, title || url, source);
        return res.json({ ok: true, jobId: job.id, async: true });
      }
      const result = await ingestDocument({ title: title || url, source, text: plain });
      syncVecIfActive();
      return res.json({ ok: true, ...result });
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Provide "text" or "url"' });
    }
    const textStr = String(text);
    if (textStr.length > MAX_INGEST_TEXT) {
      return res.status(413).json({ error: `Text too large (max ${Math.floor(MAX_INGEST_TEXT / 1024 / 1024)} MB)` });
    }
    if (asAsync) {
      const job: IngestJob = {
        id: uuidv4(), status: 'queued', title: title || 'Untitled', progress: 0, chunks: 0, createdAt: new Date().toISOString(),
      };
      ingestJobs.set(job.id, job);
      void runIngestJob(job, textStr, title || 'Untitled', 'text');
      return res.json({ ok: true, jobId: job.id, async: true });
    }
    const result = await ingestDocument({ title: title || 'Untitled', source: 'text', text: textStr });
    syncVecIfActive();
    return res.json({ ok: true, ...result });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Ingest failed');
    return res.status(500).json({ error: message });
  }
});

/** Async ingest job status. */
knowledgeRouter.get('/ingest/jobs', (_req, res) => {
  const jobs = Array.from(ingestJobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50);
  res.json({ jobs });
});

knowledgeRouter.get('/ingest/jobs/:id', (req, res) => {
  const job = ingestJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({ job });
});

/** Semantic search over the knowledge base. */
knowledgeRouter.post('/search', async (req, res) => {
  try {
    const { query, topK } = req.body || {};
    if (!query || !query.trim()) return res.status(400).json({ error: 'query is required' });
    const cfg = getConfig();
    const k = Math.min(Number(topK) || cfg.topK, 20);
    const results = await search(query, { topK: k });
    res.json({ results });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Search failed');
    res.status(500).json({ error: message });
  }
});

/** Read the current RAG configuration. */
knowledgeRouter.get('/config', (_req, res) => {
  res.json({ config: getConfig() });
});

/** Update the RAG configuration (embedding model, chunking, retrieval, index). */
knowledgeRouter.put('/config', async (req, res) => {
  try {
    const body = req.body || {};
    const patch: Partial<import('../knowledge/store.js').RagConfig> = {};
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
    if (typeof body.embeddingModel === 'string') patch.embeddingModel = body.embeddingModel;
    if (typeof body.embeddingBaseUrl === 'string') patch.embeddingBaseUrl = body.embeddingBaseUrl;
    if (typeof body.embeddingApiKey === 'string') patch.embeddingApiKey = body.embeddingApiKey;
    if (num(body.chunkSize) !== undefined) patch.chunkSize = num(body.chunkSize)!;
    if (num(body.chunkOverlap) !== undefined) patch.chunkOverlap = num(body.chunkOverlap)!;
    if (['paragraph', 'sentence', 'recursive', 'token'].includes(body.chunkStrategy))
      patch.chunkStrategy = body.chunkStrategy as ChunkStrategy;
    if (['dense', 'hybrid'].includes(body.retrievalMode)) patch.retrievalMode = body.retrievalMode as RetrievalMode;
    if (typeof body.rerankEnabled === 'boolean') patch.rerankEnabled = body.rerankEnabled;
    if (num(body.topK) !== undefined) patch.topK = Math.min(Math.max(num(body.topK)!, 1), 50);
    if (num(body.scoreThreshold) !== undefined) patch.scoreThreshold = Math.min(Math.max(num(body.scoreThreshold)!, 0), 1);
    if (['bruteforce', 'sqlitevec'].includes(body.indexBackend)) patch.indexBackend = body.indexBackend as IndexBackend;
    const config = await updateConfig(patch);
    res.json({ ok: true, config });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Config update failed');
    res.status(500).json({ error: message });
  }
});

/** Re-embed the whole knowledge base with the current config (after a model change). */
knowledgeRouter.post('/rebuild', async (_req, res) => {
  try {
    const result = await rebuildIndex();
    syncVecIfActive();
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Rebuild failed');
    res.status(500).json({ error: message });
  }
});

/** Report which index backend is actually active. */
knowledgeRouter.get('/index', (_req, res) => {
  res.json(indexStatus());
});

/** Rebuild the native vec table from stored embeddings only (no embedding API calls). */
knowledgeRouter.post('/index/sync', (_req, res) => {
  try {
    const result = syncIndex();
    res.json({ ...result, status: indexStatus() });
  } catch (err: unknown) {
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Index sync failed');
    res.status(500).json({ error: message });
  }
});

knowledgeRouter.get('/docs', (_req, res) => {
  res.json({ docs: listDocs(), chunkTotal: docCount() });
});

knowledgeRouter.delete('/docs/:id', async (req, res) => {
  const ok = await deleteDoc(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  syncVecIfActive();
  res.json({ ok: true });
});
