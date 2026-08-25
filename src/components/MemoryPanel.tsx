import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Database, Plug, Plus, Trash2, Search, Loader2, ToggleLeft, ToggleRight, CheckCircle2, XCircle, GraduationCap } from 'lucide-react';
import { memoryApi, memoryLessonsApi, type MemoryProviderInfo, type MemoryEntry } from '../api/client';

const INJECT_KEY = 'memory_inject_enabled';

export function MemoryPanel() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [inject, setInject] = useState(() => {
    try { return localStorage.getItem(INJECT_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [lessons, setLessons] = useState<MemoryEntry[]>([]);

  const loadProviders = useCallback(async () => {
    try {
      const { providers } = await memoryApi.providers();
      setProviders(providers);
    } catch (e: any) {
      setError(e.message || 'backend unavailable');
    }
  }, []);

  const loadEntries = useCallback(async () => {
    try {
      const r = await memoryApi.list();
      setEntries(r.entries);
      setSources(r.sources);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadProviders();
    void loadEntries();
  }, [loadProviders, loadEntries]);

  // 经验回放：自动蒸馏的失败教训
  useEffect(() => {
    memoryLessonsApi.list().then((r) => setLessons(r.lessons)).catch(() => {});
  }, []);

  const toggleProvider = async (p: MemoryProviderInfo) => {
    setBusy(true);
    setError('');
    try {
      await memoryApi.activate(p.id, !p.active);
      await loadProviders();
      await loadEntries();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await memoryApi.search(query.trim(), 10);
      setEntries(r.results.map((x) => ({ ...x, providerId: x.providerId })));
      setSources(r.sources);
    } finally {
      setSearching(false);
    }
  };

  const resetList = () => {
    setQuery('');
    void loadEntries();
  };

  const addEntry = async () => {
    if (!newContent.trim()) return;
    setBusy(true);
    setError('');
    try {
      await memoryApi.add(newContent.trim(), newTags.split(',').map((x) => x.trim()).filter(Boolean));
      setNewContent('');
      setNewTags('');
      setNotice(`✓ ${t('memory.saved')}`);
      await loadEntries();
      setTimeout(() => setNotice(''), 1500);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (id: string) => {
    await memoryApi.remove(id);
    await loadEntries();
  };

  const saveEdit = async (id: string) => {
    await memoryApi.update(id, { content: editContent });
    setEditingId(null);
    await loadEntries();
  };

  const toggleInject = () => {
    const next = !inject;
    setInject(next);
    try { localStorage.setItem(INJECT_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('memory.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">
            {t('memory.subtitle')}
          </span>
        </div>
        {/* 注入开关 */}
        <button
          onClick={toggleInject}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-mono transition-colors ${
            inject
              ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
              : 'border-border text-text-muted hover:text-text-secondary'
          }`}
        >
          {inject ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {inject ? t('memory.injectOn') : t('memory.injectOff')}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 max-w-3xl">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 max-w-3xl">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}

      {/* Provider 来源 */}
      <div className="max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`border rounded-xl p-4 transition-colors ${
              p.active ? 'border-violet-500/40 bg-violet-500/5' : 'border-border bg-bg-card/50'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-2 text-sm font-medium text-text-primary font-mono">
                {p.kind === 'local' ? <Database className="w-4 h-4 text-emerald-400" /> : <Plug className="w-4 h-4 text-sky-400" />}
                {p.label}
              </span>
              <span className={`flex items-center gap-1 text-[10px] font-mono ${p.available ? 'text-emerald-400' : 'text-text-muted'}`}>
                {p.available ? '●' : '○'} {p.available ? t('memory.available') : t('memory.unavailable')}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] font-mono text-text-muted">{p.kind === 'mcp' ? 'MCP protocol' : 'SQLite built-in'}</span>
              <button
                onClick={() => void toggleProvider(p)}
                disabled={busy || (!p.available && !p.active)}
                className="text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40"
                style={{
                  borderColor: p.active ? 'rgba(139,92,246,0.5)' : 'var(--color-border)',
                  color: p.active ? '#c4b5fd' : 'var(--color-text-muted)',
                }}
              >
                {p.active ? '✓ ' + t('memory.active') : t('memory.activate')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 新增 */}
      <div className="max-w-3xl border border-border bg-bg-card/50 rounded-xl p-4 mb-5">
        <div className="flex gap-2 mb-2">
          <input
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            placeholder={t('memory.addPh')}
            className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-primary"
          />
          <input
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder={t('memory.tagsPh')}
            className="w-36 px-3 py-2 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
          />
          <button
            onClick={addEntry}
            disabled={busy || !newContent.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-sm font-medium disabled:opacity-40 hover:bg-violet-500/30 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('memory.save')}
          </button>
        </div>
        <p className="text-[10px] font-mono text-text-muted">{t('memory.saveHint')}</p>
      </div>

      {/* 经验回放：失败教训库 */}
      {lessons.length > 0 && (
        <details className="max-w-3xl border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 mb-5" open={false}>
          <summary className="flex items-center gap-2 text-xs font-mono text-amber-400/90 cursor-pointer select-none">
            <GraduationCap className="w-4 h-4" />
            {t('memory.lessons')} ({lessons.length}) — auto-distilled from agent failures
          </summary>
          <div className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-2">
            {lessons.slice(0, 10).map((l) => (
              <div key={l.id} className="rounded-lg bg-bg-darker/60 border border-border p-3">
                <pre className="whitespace-pre-wrap text-[11px] text-text-secondary font-mono leading-relaxed">{l.content}</pre>
                <div className="text-[10px] font-mono text-text-muted mt-1">{new Date(l.updatedAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 搜索 + 列表 */}
      <div className="max-w-3xl border border-border bg-bg-card/50 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder={t('memory.searchPh')}
            className="flex-1 bg-transparent text-sm text-text-primary focus:outline-none"
          />
          <button onClick={() => void doSearch()} disabled={searching} className="text-[11px] font-mono text-sky-400 hover:underline disabled:opacity-50">
            {searching ? '…' : 'search'}
          </button>
          {query && (
            <button onClick={resetList} className="text-[11px] font-mono text-text-muted hover:text-text-secondary">
              ✕
            </button>
          )}
          {sources.length > 0 && (
            <span className="text-[10px] font-mono text-text-muted">↳ {sources.join(', ')}</span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {entries.map((e) => (
            <div key={e.id} className="px-4 py-3">
              {editingId === e.id ? (
                <div className="flex gap-2">
                  <textarea
                    value={editContent}
                    onChange={(ev) => setEditContent(ev.target.value)}
                    rows={2}
                    className="flex-1 px-2 py-1.5 rounded bg-bg-input border border-border text-xs text-text-primary focus:outline-none"
                  />
                  <button onClick={() => void saveEdit(e.id)} className="text-[11px] text-emerald-400 hover:underline">✓</button>
                  <button onClick={() => setEditingId(null)} className="text-[11px] text-text-muted hover:underline">✕</button>
                </div>
              ) : (
                <div className="flex items-start gap-2 group">
                  <p className="flex-1 text-sm text-text-primary whitespace-pre-wrap">{e.content}</p>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingId(e.id); setEditContent(e.content); }}
                      className="text-[11px] text-text-muted hover:text-sky-400"
                    >
                      edit
                    </button>
                    <button onClick={() => void deleteEntry(e.id)} className="text-[11px] text-text-muted hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono">
                <span className="text-text-muted">{e.providerId ?? e.source}</span>
                {(e.tags ?? []).map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-bg-darker border border-border text-text-muted">#{tag}</span>
                ))}
                {typeof e.score === 'number' && <span className="text-amber-400/80">score {e.score.toFixed(3)}</span>}
                <span className="ml-auto text-text-muted">{new Date(e.updatedAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
          {entries.length === 0 && (
            <p className="text-sm text-text-muted py-10 text-center font-mono">{t('memory.empty')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
