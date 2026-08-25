import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Radar, RefreshCw, Loader2 } from 'lucide-react';
import { driftApi, type DriftPoint } from '../api/client';

export function DriftPanel() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<DriftPoint[]>([]);
  const [events, setEvents] = useState(0);
  const [count, setCount] = useState(0);
  const [driftRate, setDriftRate] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await driftApi.state(sessionId || undefined);
      setHistory(r.history ?? []);
      setEvents(r.events ?? 0);
      setCount(r.count ?? 0);
      setDriftRate(r.driftRate ?? 0);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // 折线图：漂移分数
  const W = 720;
  const H = 200;
  const pad = 30;
  const maxScore = 1;
  const pts = history.map((h, i) => {
    const x = history.length > 1 ? pad + (i / (history.length - 1)) * (W - pad * 2) : W / 2;
    const y = H - pad - (Math.min(h.score, maxScore) / maxScore) * (H - pad * 2);
    return { x, y, point: h };
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${pts[pts.length - 1].x},${H - pad} L${pts[0].x},${H - pad} Z` : '';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radar className="w-5 h-5 text-amber-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('drift.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">
            {t('drift.subtitle')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder={t('trace.sessionPh')}
            className="w-44 px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => void load()}
            disabled={busy}
            className="p-1.5 rounded-lg border border-border hover:border-border-light text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 指标卡 */}
      <div className="grid grid-cols-3 gap-4 max-w-3xl mb-5">
        <div className="border border-border bg-bg-card/50 rounded-xl p-4 text-center">
          <div className="text-2xl font-mono font-semibold text-text-primary">{count}</div>
          <div className="text-[10px] font-mono text-text-muted mt-1 uppercase">{t('drift.messages')}</div>
        </div>
        <div className="border border-border bg-bg-card/50 rounded-xl p-4 text-center">
          <div className={`text-2xl font-mono font-semibold ${events > 0 ? 'text-amber-400' : 'text-text-primary'}`}>{events}</div>
          <div className="text-[10px] font-mono text-text-muted mt-1 uppercase">{t('drift.events')}</div>
        </div>
        <div className="border border-border bg-bg-card/50 rounded-xl p-4 text-center">
          <div className={`text-2xl font-mono font-semibold ${driftRate > 0.3 ? 'text-red-400' : driftRate > 0.1 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {(driftRate * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] font-mono text-text-muted mt-1 uppercase">{t('drift.rate')}</div>
        </div>
      </div>

      {/* 漂移曲线 */}
      <div className="max-w-3xl border border-border bg-bg-card/50 rounded-xl p-4 mb-5">
        <span className="text-xs font-mono text-text-secondary block mb-2">{t('drift.curve')}</span>
        {history.length === 0 ? (
          <p className="text-sm text-text-muted py-10 text-center font-mono">{t('drift.empty')}</p>
        ) : (
          <svg width={W} height={H} className="block max-w-full">
            {/* 阈值线 */}
            <line x1={pad} y1={H - pad - 0.6 * (H - pad * 2)} x2={W - pad} y2={H - pad - 0.6 * (H - pad * 2)} stroke="rgba(250,204,21,0.3)" strokeDasharray="4 3" />
            <text x={W - pad - 30} y={H - pad - 0.6 * (H - pad * 2) - 4} fontSize={9} fill="rgba(250,204,21,0.5)" fontFamily="monospace">0.6</text>
            <path d={area} fill="rgba(250,204,21,0.08)" />
            <path d={line} fill="none" stroke="#e0af68" strokeWidth="1.6" />
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={p.point.isEvent ? 4 : 2.5} fill={p.point.isEvent ? '#f7768e' : '#e0af68'} />
            ))}
          </svg>
        )}
      </div>

      {/* 事件流 */}
      {history.length > 0 && (
        <div className="max-w-3xl border border-border bg-bg-card/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border text-xs font-mono text-text-secondary">{t('drift.stream')}</div>
          <div className="max-h-72 overflow-y-auto divide-y divide-border/50">
            {[...history].reverse().slice(0, 60).map((h, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2">
                <span
                  className={`w-14 text-right text-[10px] font-mono ${h.isEvent ? 'text-red-400' : h.score > 0.3 ? 'text-amber-400' : 'text-text-muted'}`}
                >
                  {h.score.toFixed(2)}
                </span>
                <span className="text-[10px] font-mono text-text-muted shrink-0">
                  {new Date(h.ts).toLocaleTimeString()}
                </span>
                <span className="truncate text-xs text-text-primary">{h.text}</span>
                {h.isEvent && <span className="ml-auto text-[9px] font-mono text-red-400 shrink-0">DRIFT</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
