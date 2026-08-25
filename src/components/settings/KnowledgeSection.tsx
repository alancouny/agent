// ============================================================
// KnowledgeSection — 知识库（RAG）设置（原 Settings.tsx renderKnowledgeSection 平移）。
// 自带 docs/ragConfig/indexInfo/kb* 等 state 与加载/保存/重建逻辑，行为不变。
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Trash2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { knowledgeApi } from '../../api/client';

export interface KnowledgeSectionProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function KnowledgeSection({ onNotify }: KnowledgeSectionProps) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<{ id: string; title: string; source: string | null; chunk_count: number }[]>([]);
  const [ragConfig, setRagConfig] = useState<Record<string, unknown>>({
    embeddingModel: 'text-embedding-3-small',
    embeddingBaseUrl: '',
    embeddingApiKey: '',
    chunkSize: 900,
    chunkOverlap: 120,
    chunkStrategy: 'paragraph',
    retrievalMode: 'dense',
    rerankEnabled: false,
    topK: 5,
    scoreThreshold: 0.2,
    indexBackend: 'bruteforce',
  });
  const [rebuilding, setRebuilding] = useState(false);
  const [indexInfo, setIndexInfo] = useState<{ configured: string; effective: string; sqliteVecAvailable: boolean } | null>(null);
  const [rebuildNote, setRebuildNote] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [kbError, setKbError] = useState('');
  const [kbTitle, setKbTitle] = useState('');
  const [kbText, setKbText] = useState('');
  const [kbUrl, setKbUrl] = useState('');
  const [kbBusy, setKbBusy] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const loadKnowledge = useCallback(async () => {
    try {
      const data = await knowledgeApi.docs();
      setDocs(data.docs || []);
      setKbError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('kb.unreachable');
      setKbError(message);
    }
  }, [t]);

  const loadRagConfig = useCallback(async () => {
    try {
      const c = await knowledgeApi.getConfig();
      setRagConfig(c);
    } catch { /* best-effort RAG config load */ }
    try {
      const s = await knowledgeApi.indexStatus();
      setIndexInfo(s);
    } catch { /* best-effort RAG index status */ }
  }, []);

  useEffect(() => {
    loadKnowledge();
    loadRagConfig();
  }, [loadKnowledge, loadRagConfig]);

  const updateRagField = (key: string, value: unknown) => {
    setRagConfig((prev: Record<string, unknown>) => ({ ...prev, [key]: value }));
  };

  const saveRagConfig = async () => {
    try {
      const c = await knowledgeApi.updateConfig(ragConfig);
      setRagConfig(c);
      const s = await knowledgeApi.indexStatus();
      setIndexInfo(s);
      onNotify('success', t('common.saved'));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onNotify('error', err?.response?.data?.error || t('common.save') + ' failed');
    }
  };

  const handleRebuild = async () => {
    if (!confirm('Re-embed the entire knowledge base with the current model? This re-processes all documents and may take a while.')) return;
    setRebuilding(true);
    setRebuildNote(null);
    try {
      const r = await knowledgeApi.rebuild();
      setRebuildNote({ type: 'success', message: `Rebuilt ${r.docs} docs / ${r.chunks} chunks` });
      onNotify('success', 'Index rebuilt');
      loadKnowledge();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setRebuildNote({ type: 'error', message: err?.response?.data?.error || t('kb.rebuildFailed') });
      onNotify('error', t('kb.rebuildFailed'));
    } finally {
      setRebuilding(false);
    }
  };

  const ingest = async () => {
    if (!kbText.trim() && !kbUrl.trim()) {
      onNotify('error', 'Paste kbText or a URL');
      return;
    }
    setKbBusy(true);
    try {
      const res = await knowledgeApi.ingest({ title: kbTitle || undefined, text: kbText || undefined, url: kbUrl || undefined });
      if (res.ok) {
        onNotify('success', t('kb.ingested', { title: res.kbTitle, chunks: res.chunks }));
        setKbTitle(''); setKbText(''); setKbUrl('');
        loadKnowledge();
      } else {
        onNotify('error', t('kb.ingestFailed'));
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onNotify('error', err?.response?.data?.error || t('kb.ingestFailed'));
    } finally {
      setKbBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await knowledgeApi.deleteDoc(id);
      onNotify('success', 'Document deleted');
      loadKnowledge();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onNotify('error', err?.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-4">Knowledge Base (RAG)</h2>
        <p className="text-text-secondary text-sm">
          Ingest documents so the agent can retrieve relevant context. Embeddings use an OpenAI-compatible
          <code className="mx-1 px-1 bg-bg-input rounded">/embeddings</code> endpoint (set
          <code className="mx-1 px-1 bg-bg-input rounded">EMBEDDING_*</code> env vars).
        </p>
      </div>

      {kbError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />
            {kbError} — 请确认后端已启动
          </div>
          <button onClick={() => { setKbError(''); loadKnowledge(); loadRagConfig(); }}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-500 text-xs hover:bg-red-500/30 transition">
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">{t('kb.ragConfig')}</h3>
          {indexInfo && (
            <span className="text-xs px-2 py-1 rounded-full bg-bg-input text-text-secondary">
              index: {indexInfo.effective}
              {!indexInfo.sqliteVecAvailable && indexInfo.configured === 'sqlitevec' ? ' (ext missing → fallback)' : ''}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.embeddingModel')}</label>
            <input
              list="emb-models"
              type="text"
              value={String(ragConfig.embeddingModel ?? '')}
              onChange={(e) => updateRagField('embeddingModel', e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
            />
            <datalist id="emb-models">
              <option value="text-embedding-3-small" />
              <option value="text-embedding-3-large" />
              <option value="text-embedding-ada-002" />
              <option value="nomic-embed-kbText" />
              <option value="bge-m3" />
            </datalist>
            <p className="text-xs text-text-muted mt-1">OpenAI-compatible. e.g. nomic-embed-kbText for local Ollama.</p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.embeddingBaseUrl')}</label>
            <input
              type="text"
              value={String(ragConfig.embeddingBaseUrl ?? '')}
              onChange={(e) => updateRagField('embeddingBaseUrl', e.target.value)}
              placeholder={t('kb.embeddingBaseUrlPh')}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.embeddingApiKey')}</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={String(ragConfig.embeddingApiKey ?? '')}
                onChange={(e) => updateRagField('embeddingApiKey', e.target.value)}
                placeholder={t('kb.embeddingApiKeyPh')}
                className="w-full px-4 py-2.5 pr-12 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">Leave blank to use the server's EMBEDDING_API_KEY env var.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.chunkSize')}</label>
            <input
              type="number"
              min={100}
              max={8000}
              value={String(ragConfig.chunkSize ?? '')}
              onChange={(e) => updateRagField('chunkSize', Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.chunkOverlap')}</label>
            <input
              type="number"
              min={0}
              max={2000}
              value={String(ragConfig.chunkOverlap ?? '')}
              onChange={(e) => updateRagField('chunkOverlap', Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.chunkStrategy')}</label>
            <select
              value={String(ragConfig.chunkStrategy ?? '')}
              onChange={(e) => updateRagField('chunkStrategy', e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            >
              <option value="paragraph">{t('kb.strategy.paragraph')}</option>
              <option value="sentence">{t('kb.strategy.sentence')}</option>
              <option value="recursive">{t('kb.strategy.recursive')}</option>
              <option value="token">{t('kb.strategy.token')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.retrievalMode')}</label>
            <select
              value={String(ragConfig.retrievalMode ?? '')}
              onChange={(e) => updateRagField('retrievalMode', e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            >
              <option value="dense">{t('kb.mode.dense')}</option>
              <option value="hybrid">{t('kb.mode.hybrid')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.topK')}</label>
            <input
              type="number"
              min={1}
              max={50}
              value={String(ragConfig.topK ?? '')}
              onChange={(e) => updateRagField('topK', Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.scoreThreshold')}</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={String(ragConfig.scoreThreshold ?? '')}
              onChange={(e) => updateRagField('scoreThreshold', Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">{t('kb.indexBackend')}</label>
            <select
              value={String(ragConfig.indexBackend ?? '')}
              onChange={(e) => updateRagField('indexBackend', e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
            >
              <option value="bruteforce">{t('kb.backend.bruteforce')}</option>
              <option value="sqlitevec">{t('kb.backend.sqlitevec')}</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-text-primary">{t('kb.rerank')}</h4>
              <p className="text-xs text-text-secondary">{t('kb.rerankDesc')}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={!!ragConfig.rerankEnabled}
                onChange={(e) => updateRagField('rerankEnabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={saveRagConfig}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            Save configuration
          </button>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {rebuilding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {rebuilding ? 'Rebuilding…' : 'Rebuild index'}
          </button>
          {rebuildNote && (
            <span className={rebuildNote.type === 'success' ? 'text-sm text-green-500' : 'text-sm text-red-500'}>
              {rebuildNote.message}
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Changing the embedding model changes vector dimensions — click <strong>{t('kb.rebuildIndex')}</strong> to re-embed all documents.
        </p>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">{t('kb.addDocument')}</h3>
        <input
          type="text"
          value={kbTitle}
          onChange={(e) => setKbTitle(e.target.value)}
          placeholder={t('kb.titlePh')}
          className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
        />
        <textarea
          value={kbText}
          onChange={(e) => setKbText(e.target.value)}
          placeholder={t('kb.ingestPh')}
          rows={6}
          className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary font-mono text-sm"
        />
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <span>{t('kb.or')}</span>
        </div>
        <input
          type="text"
          value={kbUrl}
          onChange={(e) => setKbUrl(e.target.value)}
          placeholder={t('kb.urlPh')}
          className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
        />
        <div className="flex justify-end">
          <button
            onClick={ingest}
            disabled={kbBusy}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {kbBusy ? t('kb.ingesting') : t('kb.ingest')}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-3">{t('kb.documents', { count: docs.length })}</h3>
        {docs.length === 0 ? (
          <p className="text-text-muted text-sm">{t('kb.noDocs')}</p>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="p-4 rounded-xl bg-bg-card border border-border flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-text-primary">{d.title}</h4>
                  <p className="text-xs text-text-secondary">{d.chunk_count} chunks · {d.source || 'kbText'}</p>
                </div>
                <button
                  onClick={() => remove(d.id)}
                  className="p-2 rounded-lg text-text-secondary hover:bg-red-500/10 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
