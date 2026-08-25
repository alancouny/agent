import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitBranch, GitCommit, Plus, RefreshCw, CheckCircle2, XCircle, FolderGit2, History, GitMerge,
} from 'lucide-react';
import { gitApi, type GitStatus, type GitCommit as GitCommitType, type GitBranch as GitBranchType } from '../api/client';
import { AnsiText } from './AnsiText';

const STATUS_LABEL: Record<string, string> = {
  'M': 'M', 'A': 'A', 'D': 'D', 'R': 'R', 'C': 'C', 'U': 'U', '??': '?',
};
const STATUS_COLOR: Record<string, string> = {
  'M': 'text-amber-400', 'A': 'text-emerald-400', 'D': 'text-red-400',
  'R': 'text-sky-400', 'C': 'text-violet-400', 'U': 'text-yellow-400', '??': 'text-text-muted',
};

type Tab = 'status' | 'branches' | 'log';

export function GitPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('status');
  const [cwd, setCwd] = useState('');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [commits, setCommits] = useState<GitCommitType[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [diff, setDiff] = useState<{ stat: string; diff: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [s, b, l] = await Promise.all([gitApi.status(cwd), gitApi.branches(cwd), gitApi.log(cwd, 20)]);
      setStatus(s);
      setBranches(b.branches);
      setCommits(l.commits);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (e as Error)?.message || 'git status failed';
      setError(msg);
    }
  }, [cwd]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okMsg);
      await refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; detail?: string } }; message?: string };
      setError(err?.response?.data?.error || err?.response?.data?.detail || err?.message || '');
    } finally {
      setBusy(false);
    }
  };

  const doCommit = () => {
    if (!commitMsg.trim()) return;
    void act(
      () => gitApi.commit(cwd, commitMsg.trim(), true).then(() => setCommitMsg('')),
      `✓ ${t('git.committed')}`
    );
  };

  const doBranch = () => {
    if (!newBranch.trim()) return;
    void act(() => gitApi.createBranch(cwd, newBranch.trim()).then(() => setNewBranch('')), `✓ ${t('git.branchCreated')}`);
  };

  const doCheckout = (name: string) => void act(() => gitApi.checkout(cwd, name), `→ ${name}`);

  const showDiff = async (path: string) => {
    setError('');
    try {
      setDiff(await gitApi.diff(cwd, path));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof History }[] = [
    { id: 'status', label: t('git.statusTab'), icon: FolderGit2 },
    { id: 'branches', label: t('git.branchesTab'), icon: GitBranch },
    { id: 'log', label: t('git.logTab'), icon: History },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-amber-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('git.title')}</h1>
          {status?.branch && (
            <span className="font-mono text-xs text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded px-2 py-0.5">
              {status.branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder={t('git.cwdPlaceholder')}
            className="w-56 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => void refresh()}
            className="p-1.5 rounded-lg border border-border hover:border-border-light text-text-muted hover:text-text-primary transition-colors"
            title="refresh"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-border pb-2">
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

      {tab === 'status' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-border bg-bg-card/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-mono text-text-secondary">{t('git.changes')} ({status?.total ?? 0})</span>
              {status?.summary && (
                <span className="flex gap-1.5 font-mono text-[10px]">
                  {Object.entries(status.summary).map(([k, v]) => (
                    <span key={k} className="px-1.5 py-0.5 rounded bg-bg-darker border border-border">
                      {k} <span className={STATUS_COLOR[k] ?? 'text-text-muted'}>{v}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
            <ul className="space-y-1 max-h-[380px] overflow-y-auto pr-1">
              {status?.changes.map((c, i) => (
                <li
                  key={`${c.path}-${i}`}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-input/50 cursor-pointer font-mono text-xs group"
                  onClick={() => void showDiff(c.path)}
                >
                  <span className={`w-5 text-center shrink-0 font-bold ${STATUS_COLOR[c.status] ?? ''}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                  <span className="truncate text-text-primary group-hover:text-primary transition-colors">{c.path}</span>
                  {c.staged && <span className="ml-auto text-[9px] text-emerald-400 shrink-0">staged</span>}
                </li>
              ))}
              {status && status.total === 0 && (
                <li className="text-sm text-text-muted py-4 text-center font-mono">✨ clean working tree</li>
              )}
            </ul>
            <div className="flex gap-2 mt-3">
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doCommit()}
                placeholder={t('git.commitPlaceholder')}
                className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
              />
              <button
                onClick={doCommit}
                disabled={busy || !commitMsg.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary-hover transition-colors"
              >
                <GitCommit className="w-4 h-4" /> {t('git.commitBtn')}
              </button>
            </div>
          </div>
          <div className="border border-border bg-bg-card/50 rounded-xl p-4">
            <span className="text-sm font-mono text-text-secondary mb-2 block">{t('git.diffPreview')}</span>
            {diff ? (
              <div className="max-h-[420px] overflow-auto">
                <AnsiText text={diff.stat} dim className="text-[11px] text-text-secondary mb-2" />
                <AnsiText text={diff.diff} className="text-[11px]" />
              </div>
            ) : (
              <p className="text-sm text-text-muted py-8 text-center font-mono">{t('git.diffHint')}</p>
            )}
          </div>
        </div>
      )}

      {tab === 'branches' && (
        <div className="border border-border bg-bg-card/50 rounded-xl p-4 max-w-2xl">
          <div className="flex gap-2 mb-4">
            <input
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doBranch()}
              placeholder={t('git.newBranchPlaceholder')}
              className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
            />
            <button
              onClick={doBranch}
              disabled={busy || !newBranch.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary-hover transition-colors"
            >
              <Plus className="w-4 h-4" /> {t('git.createBranch')}
            </button>
          </div>
          <ul className="space-y-1">
            {branches.map((b) => (
              <li key={b.name} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-input/50 group">
                <GitBranch className={`w-4 h-4 ${b.current ? 'text-amber-400' : 'text-text-muted'}`} />
                <span className={`font-mono text-sm ${b.current ? 'text-amber-400 font-semibold' : 'text-text-primary'}`}>
                  {b.name}
                </span>
                {b.current && <span className="text-[9px] text-amber-400/70 font-mono">◉ current</span>}
                {b.upstream && <span className="ml-auto text-[10px] text-text-muted font-mono">↳ {b.upstream}</span>}
                {!b.current && (
                  <button
                    onClick={() => doCheckout(b.name)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-[11px] text-sky-400 hover:underline font-mono transition-opacity"
                  >
                    checkout
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'log' && (
        <div className="border border-border bg-bg-card/50 rounded-xl p-4 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <GitMerge className="w-4 h-4 text-text-muted" />
            <span className="text-sm font-mono text-text-secondary">{t('git.logTitle')}</span>
          </div>
          <ul className="space-y-0.5 border-l border-border ml-2">
            {commits.map((c) => (
              <li key={c.hash} className="relative pl-6 py-1.5">
                <span className="absolute left-[-4px] top-2.5 w-2 h-2 rounded-full bg-primary/60" />
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-amber-400">{c.short}</span>
                  <span className="text-text-primary truncate">{c.subject}</span>
                </div>
                <div className="text-[10px] text-text-muted font-mono pl-0">
                  {c.author} · {c.date}
                </div>
              </li>
            ))}
            {commits.length === 0 && <li className="text-sm text-text-muted py-4 text-center font-mono">no commits yet</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
