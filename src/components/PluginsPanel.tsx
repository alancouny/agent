import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Blocks, RefreshCw, Terminal, Play, Loader2 } from 'lucide-react';
import { pluginsApi, type PluginInfo } from '../api/client';
import { AnsiText } from './AnsiText';

export function PluginsPanel() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // 命令执行台：`plugin.command arg1 arg2`
  const [cmdLine, setCmdLine] = useState('');
  const [cmdHistory, setCmdHistory] = useState<{ input: string; output: string; ok: boolean }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await pluginsApi.list();
      setPlugins(r.plugins);
      setDir(r.dir);
    } catch { /* backend offline */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reload = async () => {
    setBusy(true);
    try {
      const r = await pluginsApi.reload();
      await load();
      setNotice(`✓ reloaded: ${r.count} plugins`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotice(`✗ ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const runCmd = async () => {
    const line = cmdLine.trim();
    if (!line || busy) return;
    const [first, ...rest] = line.split(/\s+/);
    const [plugin, command] = first.split('.');
    if (!plugin || !command) {
      setCmdHistory((p) => [...p, { input: line, output: 'usage: <plugin>.<command> [args...]', ok: false }]);
      setCmdLine('');
      return;
    }
    try {
      const r = await pluginsApi.run(plugin, command, rest);
      setCmdHistory((p) => [...p, { input: line, output: r.ok ? r.output : (r.error ?? 'failed'), ok: r.ok }]);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setCmdHistory((p) => [...p, { input: line, output: err?.response?.data?.error || err?.message || '', ok: false }]);
    }
    setCmdLine('');
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Blocks className="w-5 h-5 text-violet-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('plugins.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">{dir}</span>
        </div>
        <button
          onClick={() => void reload()}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:border-border-light hover:text-text-primary disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {t('plugins.reload')}
        </button>
      </div>

      {notice && (
        <div className="mb-4 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 font-mono">
          {notice}
        </div>
      )}

      {/* 命令执行台 */}
      <div className="border border-border bg-bg-card/50 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-1.5 mb-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-mono text-text-secondary">{t('plugins.console')}</span>
        </div>
        <div className="flex gap-2">
          <input
            value={cmdLine}
            onChange={(e) => setCmdLine(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runCmd()}
            placeholder={t('plugins.consolePlaceholder')}
            className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-border font-mono text-sm text-emerald-300 focus:outline-none focus:border-emerald-500/50"
            spellCheck={false}
          />
          <button
            onClick={() => void runCmd()}
            disabled={busy || !cmdLine.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-sm font-medium disabled:opacity-40 hover:bg-emerald-500/30 transition-colors"
          >
            <Play className="w-4 h-4" /> run
          </button>
        </div>
        <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
          {cmdHistory.map((h, i) => (
            <div key={i}>
              <div className="font-mono text-xs text-text-muted">
                <span className="text-emerald-400">❯</span> {h.input}
              </div>
              <AnsiText text={h.output} dim className="text-[11px] ml-4 text-text-secondary" />
            </div>
          ))}
          {cmdHistory.length === 0 && (
            <p className="text-[11px] font-mono text-text-muted">{t('plugins.consoleHint')}</p>
          )}
        </div>
      </div>

      {/* 插件列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {plugins.map((p) => (
          <div key={p.name} className="border border-border bg-bg-card/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-sm font-semibold text-violet-400">{p.name}</span>
              {p.version && <span className="text-[10px] font-mono text-text-muted">v{p.version}</span>}
            </div>
            <p className="text-xs text-text-secondary mb-3">{p.description}</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {p.commands.map((c) => (
                <button
                  key={c}
                  onClick={() => setCmdLine(`${p.name}.${c} `)}
                  className="px-2 py-0.5 rounded bg-bg-darker border border-border font-mono text-[11px] text-sky-400 hover:border-sky-500/40 transition-colors"
                >
                  {p.name}.{c}
                </button>
              ))}
              {p.hooks.map((h) => (
                <span key={h} className="px-2 py-0.5 rounded bg-bg-darker border border-border font-mono text-[11px] text-amber-400/80">
                  hook:{h}
                </span>
              ))}
            </div>
            <button
              onClick={() => setExpanded((e) => (e === p.name ? null : p.name))}
              className="text-[11px] font-mono text-text-muted hover:text-text-secondary"
            >
              {expanded === p.name ? '▾ hide' : '▸ how to write'} plugin
            </button>
            {expanded === p.name && (
              <pre className="mt-2 text-[10px] font-mono text-text-secondary bg-black/30 rounded-lg p-3 overflow-x-auto">
{`// backend/plugins/<name>.js
export default {
  name: 'my-plugin',
  description: '...',
  commands: {
    hello: async (args, { cwd }) =>
      ({ ok: true, output: \`hi \${args.join(' ')}\` }),
  },
  hooks: {
    beforeModelCall: async (ctx) => ctx,
  },
};`}
              </pre>
            )}
          </div>
        ))}
        {plugins.length === 0 && (
          <p className="text-sm text-text-muted py-8 text-center font-mono col-span-2">{t('plugins.empty')}</p>
        )}
      </div>
    </div>
  );
}
