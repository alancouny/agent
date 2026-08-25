import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import { telemetryApi, apiFetch, type LLMCallRecord } from '../api/client';

const KIND_COLOR: Record<string, string> = {
  main: '#7aa2f7',
  delegate: '#bb9af7',
  supervisor: '#e0af68',
  worker: '#7dcfff',
};

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}
function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function LLMFlameChart() {
  const { t } = useTranslation();
  const [calls, setCalls] = useState<LLMCallRecord[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<LLMCallRecord | null>(null);
  const [error, setError] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(880);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { calls } = await telemetryApi.llmCalls(sessionId || undefined);
      setCalls(calls);
      setError('');
    } catch (e: any) {
      setError(e.message || 'failed to load traces');
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // 3s 自动刷新 + 容器尺寸自适应
  useEffect(() => {
    const iv = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(600, el.clientWidth - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clear = async () => {
    try {
      await apiFetch(`/api/telemetry/llm-calls${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { method: 'DELETE' });
      setCalls([]);
    } catch { /* ignore */ }
  };

  if (calls.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-400" />
            <h1 className="text-lg font-semibold font-mono tracking-wide">{t('trace.title')}</h1>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:border-border-light disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            refresh
          </button>
        </div>
        <p className="text-sm text-text-muted py-16 text-center font-mono">{t('trace.empty')}</p>
      </div>
    );
  }

  // 时间轴缩放：相对最早 startAt，含 padding
  const t0 = Math.min(...calls.map((c) => c.startAt));
  const t1 = Math.max(...calls.map((c) => c.endAt || c.startAt));
  const span = Math.max(t1 - t0, 1);
  const pad = 24;
  const rowH = 30;
  const xOf = (t: number) => pad + ((t - t0) / span) * (width - pad * 2);
  const wOf = (c: LLMCallRecord) => Math.max(3, xOf(c.endAt || c.startAt) - xOf(c.startAt));
  const depthOf = (c: LLMCallRecord): number => {
    let depth = 0;
    let cur: LLMCallRecord | null = c;
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = calls.find((x) => x.id === cur!.parentId) ?? null;
      if (cur) depth += 1;
    }
    return depth;
  };

  const height = calls.length * rowH + 16;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('trace.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">
            {calls.length} calls · {fmtMs(span)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder={t('trace.sessionPh')}
            className="w-48 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => void load()}
            disabled={busy}
            className="p-1.5 rounded-lg border border-border hover:border-border-light text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
            title="refresh"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button
            onClick={clear}
            className="p-1.5 rounded-lg border border-border hover:border-red-500/40 text-text-muted hover:text-red-400 transition-colors"
            title="clear"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* 图例 */}
      <div className="flex items-center gap-4 mb-2 text-[11px] font-mono text-text-muted">
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} /> {k}
          </span>
        ))}
      </div>

      <div className="border border-border bg-bg-card/50 rounded-xl p-4 overflow-x-auto">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          {/* 时间网格线（每 25% 一格） */}
          {[0.25, 0.5, 0.75].map((f) => (
            <g key={f}>
              <line x1={pad + f * (width - pad * 2)} y1={0} x2={pad + f * (width - pad * 2)} y2={height} stroke="rgba(148,163,184,0.08)" />
            </g>
          ))}

          {calls.map((c, i) => {
            const y = 8 + i * rowH;
            const depth = depthOf(c);
            const x = xOf(c.startAt);
            const w = wOf(c);
            const color = KIND_COLOR[c.agentKind] ?? '#94a3b8';
            const isHover = hover?.id === c.id;
            return (
              <g
                key={c.id}
                transform={`translate(0, ${y})`}
                onMouseEnter={() => setHover(c)}
                className="cursor-pointer"
              >
                {/* 层级缩进条 + 父依赖虚线连接 */}
                {c.parentId && (
                  <line
                    x1={x}
                    y1={-rowH + 12}
                    x2={x}
                    y2={-3}
                    stroke="rgba(148,163,184,0.35)"
                    strokeDasharray="3 2"
                    strokeWidth={1}
                  />
                )}
                <rect
                  x={x + depth * 10}
                  y={3}
                  width={Math.max(3, w - depth * 10)}
                  height={rowH - 8}
                  rx={4}
                  fill={color}
                  fillOpacity={isHover ? 0.95 : c.failed ? 0.45 : 0.75}
                  stroke={isHover ? '#fff' : color}
                  strokeWidth={isHover ? 1.2 : 0}
                  style={isHover ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
                />
                {w > 90 && (
                  <text
                    x={x + depth * 10 + 6}
                    y={rowH - 8}
                    fill="#0b1020"
                    fontSize={10}
                    fontFamily="ui-monospace, monospace"
                    className="select-none"
                  >
                    {c.agentKind}:{c.model.split('/').pop()} · {fmtMs(c.durationMs)} · {fmtTok(c.totalTokens)} tok
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* tooltip */}
        {hover && (
          <div className="mt-3 border border-border rounded-lg bg-bg-darker p-3 font-mono text-[11px] space-y-1 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: KIND_COLOR[hover.agentKind] ?? '#94a3b8' }} />
              <span className="text-text-primary font-semibold">{hover.agentKind}</span>
              <span className="text-text-muted">→ {hover.model}</span>
              {hover.failed && <span className="text-red-400">FAILED</span>}
            </div>
            <div className="text-text-secondary">
              {t('trace.time')}: {fmtMs(hover.durationMs)} · {t('trace.tokens')}: {fmtTok(hover.promptTokens)}p / {fmtTok(hover.completionTokens)}c · turn {hover.turn}.{hover.step}
            </div>
            {hover.toolNames.length > 0 && (
              <div className="text-text-secondary">
                {t('trace.tools')}: <span className="text-sky-400">{hover.toolNames.join(', ')}</span>
              </div>
            )}
            {hover.contentPreview && (
              <div className="text-text-muted line-clamp-2">"{hover.contentPreview}"</div>
            )}
            {hover.parentId && <div className="text-text-muted">parent: {hover.parentId.slice(0, 8)}…</div>}
          </div>
        )}
      </div>
    </div>
  );
}
