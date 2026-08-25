import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Replace, FilePen, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { textToolsApi, type TextSearchResult, type ReplacePreview } from '../api/client';

type Tab = 'search' | 'replace' | 'rename';

export function TextTools() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('search');
  const [cwd, setCwd] = useState('');
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  // search
  const [results, setResults] = useState<TextSearchResult[]>([]);
  const [searchInfo, setSearchInfo] = useState<{ count: number; truncated: boolean } | null>(null);

  // replace
  const [previews, setPreviews] = useState<ReplacePreview[]>([]);
  const [replaceInfo, setReplaceInfo] = useState<{ total: number } | null>(null);

  // rename
  const [renameRows, setRenameRows] = useState<{ path: string; newName: string }[]>([]);
  const [renamed, setRenamed] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err?.message || '');
    } finally {
      setBusy(false);
    }
  };

  const doSearch = () =>
    act(async () => {
      const r = await textToolsApi.search(pattern, cwd, caseSensitive);
      setResults(r.results);
      setSearchInfo({ count: r.count, truncated: r.truncated });
    });

  const doReplace = (dryRun: boolean) =>
    act(async () => {
      const files = previews.map((p) => p.file);
      const r = await textToolsApi.replace(pattern, replacement, files, cwd, dryRun);
      if (dryRun) {
        setPreviews(r.previews);
        setReplaceInfo({ total: r.total });
      } else {
        setNotice(`✓ ${t('texttools.replaced')} ${r.applied.length} ${t('texttools.files')}`);
        setPreviews([]);
        setReplaceInfo(null);
      }
    });

  const addRenameRow = () => setRenameRows((p) => [...p, { path: '', newName: '' }]);
  const updateRow = (i: number, patch: Partial<{ path: string; newName: string }>) =>
    setRenameRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const doRename = () =>
    act(async () => {
      const valid = renameRows.filter((r) => r.path.trim() && r.newName.trim());
      if (!valid.length) return;
      const r = await textToolsApi.rename(cwd, valid);
      setRenamed(r.renamed.map((x: { to: string }) => x.to));
      setNotice(`✓ ${t('texttools.renamed')} ${r.renamed.length}`);
      setRenameRows([]);
    });

  const tabs = [
    { id: 'search' as Tab, label: t('texttools.searchTab'), icon: Search },
    { id: 'replace' as Tab, label: t('texttools.replaceTab'), icon: Replace },
    { id: 'rename' as Tab, label: t('texttools.renameTab'), icon: FilePen },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-4">
        <Replace className="w-5 h-5 text-sky-400" />
        <h1 className="text-lg font-semibold font-mono tracking-wide">{t('texttools.title')}</h1>
      </div>

      <div className="flex items-center gap-2 mb-4 max-w-2xl">
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t('texttools.cwdPlaceholder')}
          className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
        />
        <label className="flex items-center gap-1.5 text-xs text-text-muted font-mono select-none">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="accent-primary" />
          Aa
        </label>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 max-w-2xl">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 max-w-2xl">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-border pb-2 max-w-2xl">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              tab === id ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <div className="max-w-3xl">
          <div className="flex gap-2 mb-3">
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder={t('texttools.regexPlaceholder')}
              className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm font-mono text-primary focus:outline-none focus:border-primary"
            />
            <button
              onClick={doSearch}
              disabled={busy || !pattern.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary-hover transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {t('texttools.searchBtn')}
            </button>
          </div>
          {searchInfo && (
            <p className="text-[11px] font-mono text-text-muted mb-2">
              {searchInfo.count} {t('texttools.matches')}
              {searchInfo.truncated ? ` (${t('texttools.truncated')})` : ''}
            </p>
          )}
          <div className="border border-border bg-bg-card/50 rounded-xl overflow-hidden">
            {results.map((r, i) => (
              <div key={i} className="flex gap-2 px-3 py-1.5 border-b border-border/50 last:border-0 font-mono text-xs hover:bg-bg-input/40">
                <span className="text-text-muted shrink-0 w-24 truncate">{r.file}</span>
                <span className="text-amber-400 shrink-0 w-8 text-right">{r.line}</span>
                <span className="text-text-primary truncate">{r.text}</span>
              </div>
            ))}
            {searchInfo && searchInfo.count === 0 && (
              <p className="text-sm text-text-muted py-8 text-center font-mono">no matches</p>
            )}
          </div>
        </div>
      )}

      {tab === 'replace' && (
        <div className="max-w-3xl">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t('texttools.regexPlaceholder')}
              className="px-3 py-2 rounded-lg bg-bg-input border border-border text-sm font-mono text-primary focus:outline-none focus:border-primary"
            />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={t('texttools.replacementPlaceholder')}
              className="px-3 py-2 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => doReplace(true)}
              disabled={busy || !pattern.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-sky-500/40 text-sky-400 text-sm font-medium disabled:opacity-40 hover:bg-sky-500/10 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {t('texttools.dryRunBtn')}
            </button>
            <button
              onClick={() => doReplace(false)}
              disabled={busy || previews.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-red-400 text-sm font-medium disabled:opacity-40 hover:bg-red-500/20 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              {t('texttools.applyBtn')}
            </button>
          </div>
          {replaceInfo && (
            <p className="text-[11px] font-mono text-amber-400 mb-2">
              ⚠ {t('texttools.affected')} {replaceInfo.total}
            </p>
          )}
          <div className="border border-border bg-bg-card/50 rounded-xl overflow-hidden">
            {previews.map((p, i) => (
              <div key={i} className="px-3 py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 font-mono text-xs mb-1">
                  <span className="text-text-muted truncate flex-1">{p.file}</span>
                  <span className="text-amber-400 shrink-0">×{p.count}</span>
                </div>
                <div className="font-mono text-[11px] text-text-secondary line-through opacity-70 truncate">{p.before}</div>
                <div className="font-mono text-[11px] text-emerald-400 truncate">→ {p.after}</div>
              </div>
            ))}
            {previews.length === 0 && (
              <p className="text-sm text-text-muted py-8 text-center font-mono">{t('texttools.dryRunHint')}</p>
            )}
          </div>
        </div>
      )}

      {tab === 'rename' && (
        <div className="max-w-3xl">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-mono text-text-muted">{t('texttools.renameHint')}</span>
            <button
              onClick={addRenameRow}
              className="text-sm text-sky-400 hover:underline font-mono"
            >
              + {t('texttools.addRow')}
            </button>
          </div>
          <div className="space-y-2 mb-3">
            {renameRows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={r.path}
                  onChange={(e) => updateRow(i, { path: e.target.value })}
                  placeholder={t('texttools.fromPath')}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
                />
                <span className="text-text-muted self-center">→</span>
                <input
                  value={r.newName}
                  onChange={(e) => updateRow(i, { newName: e.target.value })}
                  placeholder={t('texttools.toName')}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => setRenameRows((p) => p.filter((_, j) => j !== i))}
                  className="text-text-muted hover:text-red-400 px-2"
                  title="remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={doRename}
            disabled={busy || !renameRows.some((r) => r.path.trim() && r.newName.trim())}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary-hover transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePen className="w-4 h-4" />}
            {t('texttools.renameBtn')}
          </button>
          {renamed.length > 0 && (
            <div className="mt-4 border border-border bg-bg-card/50 rounded-xl p-3 space-y-1">
              {renamed.map((p) => (
                <div key={p} className="font-mono text-xs text-emerald-400">✓ {p}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
