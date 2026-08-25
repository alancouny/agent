import { useState, useRef, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Play, Plus, Trash2, Loader2, ChevronDown, ChevronRight, Zap, Coins, GitCommitHorizontal, ChartNoAxesCombined } from 'lucide-react';
import { experimentsApi, type ExperimentRunResult } from '../api/client';

interface RunCfg {
  label: string;
  model: string;
  temperature: string;
  systemPrompt: string;
}

interface ExpResult {
  runs: ExperimentRunResult[];
  wallMs: number;
  winners: { quickest: string | null; cheapest: string | null; fewestCalls: string | null };
}

const DRAFT_KEY = 'exp_lab_draft';

const TEMPLATES: { name: string; runs: RunCfg[] }[] = [
  {
    name: 'temp sweep',
    runs: [
      { label: 'temp 0', model: 'gpt-4o', temperature: '0', systemPrompt: '' },
      { label: 'temp 0.7', model: 'gpt-4o', temperature: '0.7', systemPrompt: '' },
      { label: 'temp 1.4', model: 'gpt-4o', temperature: '1.4', systemPrompt: '' },
    ],
  },
  {
    name: 'prompt battle',
    runs: [
      { label: 'baseline', model: 'gpt-4o', temperature: '0.7', systemPrompt: '' },
      { label: 'strict steps', model: 'gpt-4o', temperature: '0.7', systemPrompt: 'You must always: 1) restate the goal 2) plan 3) execute 4) verify. Be concise.' },
    ],
  },
];

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ExperimentLab() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState(() => {
    try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
  });
  const [runs, setRuns] = useState<RunCfg[]>([
    { label: 'base', model: 'gpt-4o', temperature: '0.7', systemPrompt: '' },
    { label: 'variant', model: 'gpt-4o', temperature: '0.7', systemPrompt: '' },
  ]);
  const [apiKey, setApiKey] = useState(() => {
    try {
      const s = localStorage.getItem('agent_api_settings');
      if (s) return (JSON.parse(s) as { apiKey?: string }).apiKey ?? '';
    } catch { /* ignore */ }
    return '';
  });
  const [baseUrl, setBaseUrl] = useState(() => {
    try {
      const s = localStorage.getItem('agent_api_settings');
      if (s) return (JSON.parse(s) as { baseUrl?: string }).baseUrl ?? '';
    } catch { /* ignore */ }
    return '';
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExpResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [view, setView] = useState<'table' | 'radar'>('table');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, prompt); } catch { /* ignore */ }
  }, [prompt]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateRun = (i: number, patch: Partial<RunCfg>) =>
    setRuns((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const run = async () => {
    if (!prompt.trim() || busy) return;
    const valid = runs.filter((r) => r.label.trim());
    if (!valid.length) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await experimentsApi.run(prompt, valid.map((x) => ({
        label: x.label.trim(),
        model: x.model.trim() || 'gpt-4o',
        temperature: Number(x.temperature) || undefined,
        systemPrompt: x.systemPrompt || undefined,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
      })), 15, controller.signal);
      setResult(r);
    } catch (e: any) {
      if (e.name !== 'CanceledError' && e.name !== 'AbortError') {
        setError(e.response?.data?.error || e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleExpanded = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const winner = (label: string | null) =>
    label && result?.runs.some((r) => r.label === label && r.ok) ? 'text-amber-400' : 'text-text-muted';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="w-5 h-5 text-fuchsia-400" />
        <h1 className="text-lg font-semibold font-mono tracking-wide">{t('experiments.title')}</h1>
        <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">
          {t('experiments.subtitle')}
        </span>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 max-w-4xl">
          {error}
        </div>
      )}

      <div className="max-w-4xl space-y-4">
        {/* Prompt */}
        <div className="border border-border bg-bg-card/50 rounded-xl p-4">
          <label className="text-xs font-mono text-text-secondary mb-2 block">{t('experiments.prompt')}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('experiments.promptPlaceholder')}
            spellCheck={false}
            rows={4}
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-border font-mono text-sm text-text-primary focus:outline-none focus:border-primary resize-y"
          />
        </div>

        {/* Runs config */}
        <div className="border border-border bg-bg-card/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-mono text-text-secondary">{t('experiments.runs')} ({runs.length})</label>
            <div className="flex items-center gap-2">
              {TEMPLATES.map((tp) => (
                <button
                  key={tp.name}
                  onClick={() => setRuns(tp.runs.map((r) => ({ ...r })))}
                  className="text-[11px] font-mono text-sky-400 border border-sky-500/30 rounded px-2 py-0.5 hover:bg-sky-500/10 transition-colors"
                >
                  {tp.name}
                </button>
              ))}
              <button
                onClick={() => setRuns((p) => [...p, { label: `run ${p.length + 1}`, model: 'gpt-4o', temperature: '0.7', systemPrompt: '' }])}
                disabled={runs.length >= 6}
                className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 border border-emerald-500/30 rounded px-2 py-0.5 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3 h-3" /> {t('experiments.addRun')}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {runs.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={r.label}
                  onChange={(e) => updateRun(i, { label: e.target.value })}
                  placeholder={t('experiments.labelPh')}
                  className="w-28 px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
                />
                <input
                  value={r.model}
                  onChange={(e) => updateRun(i, { model: e.target.value })}
                  placeholder="gpt-4o"
                  className="w-36 px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
                />
                <input
                  value={r.temperature}
                  onChange={(e) => updateRun(i, { temperature: e.target.value })}
                  placeholder="0.7"
                  title="temperature"
                  className="w-16 px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
                />
                <input
                  value={r.systemPrompt}
                  onChange={(e) => updateRun(i, { systemPrompt: e.target.value })}
                  placeholder={t('experiments.sysPh')}
                  className="flex-1 min-w-40 px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-secondary focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => setRuns((p) => p.filter((_, j) => j !== i))}
                  disabled={runs.length <= 1}
                  className="text-text-muted hover:text-red-400 disabled:opacity-30 px-1"
                  title="remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* API override */}
        <details className="border border-border bg-bg-card/50 rounded-xl p-4">
          <summary className="text-xs font-mono text-text-muted cursor-pointer select-none">
            {t('experiments.apiOverride')}
          </summary>
          <div className="flex gap-2 mt-3">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('experiments.baseUrlPh')}
              className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
            />
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... (empty = server env)"
              type="password"
              className="flex-1 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
        </details>

        {/* Run */}
        <button
          onClick={() => void run()}
          disabled={busy || !prompt.trim()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 text-sm font-medium disabled:opacity-40 hover:bg-fuchsia-500/30 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {busy ? t('experiments.running') : t('experiments.run')}
        </button>

        {/* Results */}
        {result && (
          <div className="border border-border bg-bg-card/50 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="text-xs font-mono text-text-secondary">
                {t('experiments.results')} · wall {fmtMs(result.wallMs)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setView('table')}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${view === 'table' ? 'bg-primary/15 text-primary' : 'text-text-muted'}`}
                >
                  table
                </button>
                <button
                  onClick={() => setView('radar')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors ${view === 'radar' ? 'bg-primary/15 text-primary' : 'text-text-muted'}`}
                >
                  <ChartNoAxesCombined className="w-3 h-3" /> {t('experiments.fingerprint')}
                </button>
              </div>
              <span className="flex items-center gap-3 text-[11px] font-mono">
                <span className={`flex items-center gap-1 ${winner(result.winners.quickest)}`}>
                  <Zap className="w-3 h-3" /> {result.winners.quickest ?? '—'}
                </span>
                <span className={`flex items-center gap-1 ${winner(result.winners.cheapest)}`}>
                  <Coins className="w-3 h-3" /> {result.winners.cheapest ?? '—'}
                </span>
                <span className={`flex items-center gap-1 ${winner(result.winners.fewestCalls)}`}>
                  <GitCommitHorizontal className="w-3 h-3" /> {result.winners.fewestCalls ?? '—'}
                </span>
              </span>
            </div>

            {view === 'radar' && <FingerprintRadar runs={result.runs} />}

            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-text-muted border-b border-border">
                  <th className="text-left px-4 py-2 font-normal">{t('experiments.labelCol')}</th>
                  <th className="text-left px-2 py-2 font-normal">{t('experiments.modelCol')}</th>
                  <th className="text-right px-2 py-2 font-normal">{t('experiments.durCol')}</th>
                  <th className="text-right px-2 py-2 font-normal">{t('experiments.tokenCol')}</th>
                  <th className="text-right px-2 py-2 font-normal">{t('experiments.callsCol')}</th>
                  <th className="text-right px-4 py-2 font-normal">{t('experiments.statusCol')}</th>
                </tr>
              </thead>
              <tbody>
                {result.runs.map((r, i) => (
                  <Fragment key={`${r.label}-${i}`}>
                    <tr
                      onClick={() => toggleExpanded(i)}
                      className={`border-b border-border/50 last:border-0 cursor-pointer hover:bg-bg-input/40 transition-colors ${
                        r.ok ? 'text-text-primary' : 'text-red-400'
                      }`}
                    >
                      <td className="px-4 py-2 flex items-center gap-1.5">
                        {expanded.has(i) ? <ChevronDown className="w-3 h-3 text-text-muted" /> : <ChevronRight className="w-3 h-3 text-text-muted" />}
                        {r.label}
                      </td>
                      <td className="px-2 py-2 text-text-secondary">{r.model}</td>
                      <td className="px-2 py-2 text-right">{fmtMs(r.durationMs)}</td>
                      <td className="px-2 py-2 text-right">{fmtTokens(r.totalTokens)}</td>
                      <td className="px-2 py-2 text-right">{r.toolCalls}</td>
                      <td className="px-4 py-2 text-right">
                        {r.ok ? <span className="text-emerald-400">✓ ok</span> : <span className="text-red-400">✗ fail</span>}
                      </td>
                    </tr>
                    {expanded.has(i) && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-3">
                          {r.ok ? (
                            <pre className="whitespace-pre-wrap text-[11px] text-text-secondary bg-black/30 rounded-lg p-3 max-h-60 overflow-y-auto">
                              {r.output || '(empty output)'}
                            </pre>
                          ) : (
                            <pre className="whitespace-pre-wrap text-[11px] text-red-400 bg-black/30 rounded-lg p-3 max-h-60 overflow-y-auto">
                              {r.error}
                            </pre>
                          )}
                          <div className="text-[10px] text-text-muted font-mono mt-1.5">
                            {t('experiments.usageDetail')}: {fmtTokens(r.promptTokens)} prompt / {fmtTokens(r.completionTokens)} completion
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


// ── 行为指纹雷达图（零依赖 SVG）──
const RADAR_COLORS = ['#7aa2f7', '#bb9af7', '#e0af68', '#9ece6a', '#f7768e', '#7dcfff'];
const RADAR_DIMS = ['tokens', 'time', 'calls', 'tools', 'score'] as const;
const DIM_LABEL: Record<string, string> = { tokens: 'tokens', time: 'time', calls: 'calls', tools: 'tool diversity', score: 'success' };

function FingerprintRadar({ runs }: { runs: ExperimentRunResult[] }) {
  const ok = runs.filter((r) => r.ok);
  if (ok.length < 2) {
    return (
      <p className="text-xs text-text-muted py-8 text-center font-mono">
        need ≥ 2 successful runs to compare fingerprints
      </p>
    );
  }
  const size = 300;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const R = size / 2 - 40;

  // 每 run 的维度值（相对最大值归一化 0..1）
  const values = ok.map((r) => {
    const maxTok = Math.max(...ok.map((x) => x.totalTokens), 1);
    const maxDur = Math.max(...ok.map((x) => x.durationMs), 1);
    const maxCalls = Math.max(...ok.map((x) => x.toolCalls), 1);
    const maxDiversity = Math.max(...ok.map((x) => x.fingerprint?.toolDiversity ?? 0), 1);
    return {
      run: r,
      v: {
        tokens: r.totalTokens / maxTok,
        time: r.durationMs / maxDur,
        calls: r.toolCalls / maxCalls,
        tools: (r.fingerprint?.toolDiversity ?? 0) / maxDiversity,
        score: 1,
      },
    };
  });

  const angle = (i: number) => (Math.PI * 2 * i) / RADAR_DIMS.length - Math.PI / 2;
  const point = (i: number, val: number) => [cx + Math.cos(angle(i)) * R * val, cy + Math.sin(angle(i)) * R * val];
  const poly = (vals: Record<string, number>) =>
    RADAR_DIMS.map((d, i) => point(i, vals[d]).map((n) => n.toFixed(1)).join(',')).join(' ');

  return (
    <div className="px-4 pt-4 flex flex-col md:flex-row items-center gap-6">
      <svg width={size} height={size + 8} className="shrink-0">
        {/* 网格 */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={poly(Object.fromEntries(RADAR_DIMS.map((d) => [d, f])))} fill="none" stroke="rgba(148,163,184,0.15)" />
        ))}
        {RADAR_DIMS.map((d, i) => {
          const [x, y] = point(i, 1.18);
          return (
            <text key={d} x={x} y={y} fontSize={9} fill="var(--color-text-muted)" textAnchor="middle" fontFamily="monospace">
              {DIM_LABEL[d]}
            </text>
          );
        })}
        {/* 各 run 指纹 */}
        {values.map(({ v }, i) => (
          <polygon
            key={i}
            points={poly(v)}
            fill={RADAR_COLORS[i % RADAR_COLORS.length]}
            fillOpacity={0.12}
            stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
            strokeWidth={1.4}
          />
        ))}
      </svg>
      <div className="space-y-2 font-mono text-[11px]">
        {values.map(({ run }, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length] }} />
            <span className="text-text-primary">{run.label}</span>
            <span className="text-text-muted">
              {run.totalTokens} tok · {fmtMs(run.durationMs)} · {run.toolCalls} calls · {run.fingerprint?.toolDiversity ?? 0} tools
            </span>
          </div>
        ))}
        <p className="text-text-muted pt-1">tool usage: {values[0].run.fingerprint ? Object.entries(values[0].run.fingerprint.toolUsage).map(([k, n]) => `${k}×${n}`).join(' · ') : '—'}</p>
      </div>
    </div>
  );
}
