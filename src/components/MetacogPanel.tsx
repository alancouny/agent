import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainCircuit, ToggleLeft, ToggleRight, Loader2, Target, Coins } from 'lucide-react';
import { metacogApi, type CostEstimate, type CalibrationBin } from '../api/client';

const COG_KEY = 'metacog_enabled';

function fmtTok(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function MetacogPanel() {
  const { t } = useTranslation();
  const [estimates, setEstimates] = useState<CostEstimate[]>([]);
  const [calibration, setCalibration] = useState<CalibrationBin[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(COG_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await metacogApi.estimates(sessionId || undefined);
      setEstimates(r.estimates);
      setCalibration(r.calibration);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(COG_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  // 校准条形图（预测桶 vs 实际均值）
  const maxVal = Math.max(...calibration.map((c) => Math.max(c.predicted, c.actual)), 1);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('metacog.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">
            self-predicted compute
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
            onClick={toggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
              enabled ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-border text-text-muted'
            }`}
          >
            {enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
            {enabled ? t('metacog.on') : t('metacog.off')}
          </button>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="p-1.5 rounded-lg border border-border hover:border-border-light text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <p className="text-xs text-text-muted font-mono mb-4 max-w-3xl">{t('metacog.hint')}</p>

      {/* 校准曲线 */}
      <div className="max-w-3xl border border-border bg-bg-card/50 rounded-xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-mono text-text-secondary">{t('metacog.calibration')}</span>
        </div>
        {calibration.length === 0 ? (
          <p className="text-sm text-text-muted py-8 text-center font-mono">{t('metacog.empty')}</p>
        ) : (
          <div className="flex items-end gap-6 overflow-x-auto pb-2">
            {calibration.map((c) => (
              <div key={c.bin} className="flex flex-col items-center gap-1">
                <div className="flex items-end gap-1.5" style={{ height: 120 }}>
                  <div
                    className="w-3 rounded-t bg-sky-400/80"
                    style={{ height: `${(c.predicted / maxVal) * 100}%`, minHeight: 4 }}
                    title={`predicted ${c.predicted}`}
                  />
                  <div
                    className="w-3 rounded-t bg-amber-400/80"
                    style={{ height: `${(c.actual / maxVal) * 100}%`, minHeight: 4 }}
                    title={`actual ${c.actual}`}
                  />
                </div>
                <span className="text-[9px] font-mono text-text-muted">{c.bin}</span>
                <span className="text-[9px] font-mono text-text-muted">n={c.n}</span>
              </div>
            ))}
          </div>
        )}
        {calibration.length > 0 && (
          <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-text-muted">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400/80" /> predicted</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/80" /> actual (avg)</span>
          </div>
        )}
      </div>

      {/* 最近记录 */}
      <div className="max-w-3xl border border-border bg-bg-card/50 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border text-xs font-mono text-text-secondary">
          {t('metacog.recent')} ({estimates.length})
        </div>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left px-4 py-2 font-normal">model</th>
              <th className="text-right px-2 py-2 font-normal">{t('metacog.predCalls')}</th>
              <th className="text-right px-2 py-2 font-normal">{t('metacog.actCalls')}</th>
              <th className="text-right px-2 py-2 font-normal">{t('metacog.predTok')}</th>
              <th className="text-right px-2 py-2 font-normal">{t('metacog.actTok')}</th>
              <th className="text-right px-4 py-2 font-normal">{t('metacog.diff')}</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map((e) => {
              const tokDiff = e.predictedTokens != null ? e.actualTokens - e.predictedTokens : null;
              return (
                <tr key={e.id} className="border-b border-border/50 last:border-0 text-text-primary">
                  <td className="px-4 py-2 text-text-secondary">{e.model}</td>
                  <td className="px-2 py-2 text-right">{e.predictedToolCalls ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{e.actualToolCalls}</td>
                  <td className="px-2 py-2 text-right">{fmtTok(e.predictedTokens)}</td>
                  <td className="px-2 py-2 text-right">{fmtTok(e.actualTokens)}</td>
                  <td className={`px-4 py-2 text-right ${tokDiff == null ? 'text-text-muted' : Math.abs(tokDiff) < 0.3 * (e.actualTokens || 1) ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {tokDiff == null ? '—' : `${tokDiff >= 0 ? '+' : ''}${fmtTok(tokDiff)}`}
                  </td>
                </tr>
              );
            })}
            {estimates.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-text-muted">{t('metacog.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
