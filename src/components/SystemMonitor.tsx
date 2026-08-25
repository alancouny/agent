import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Cpu, MemoryStick, Wifi, Server, RefreshCw, Pause } from 'lucide-react';
import { systemApi, type SystemStats } from '../api/client';
import { Sparkline, MetricRing } from './Sparkline';

// 历史窗口：120 个采样点（@2s ≈ 4 分钟曲线）
const WINDOW = 120;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function fmtRate(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(n / 1024 ** 3).toFixed(2)} GB/s`;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

const LEVEL_COLOR = (v: number) => (v < 50 ? '#9ece6a' : v < 80 ? '#e0af68' : '#f7768e');

export function SystemMonitor() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [rxHist, setRxHist] = useState<number[]>([]);
  const [txHist, setTxHist] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const push = useCallback((arr: number[], v: number): number[] => {
    const next = [...arr, v];
    return next.length > WINDOW ? next.slice(next.length - WINDOW) : next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (pausedRef.current) return;
      try {
        const s = await systemApi.stats();
        if (cancelled) return;
        setStats(s);
        setCpuHist((p) => push(p, s.cpu.usage ?? 0));
        setMemHist((p) => push(p, s.memory.percent));
        if (s.net) {
          setRxHist((p) => push(p, s.net!.rxRate / 1024));
          setTxHist((p) => push(p, s.net!.txRate / 1024));
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg || 'system stats unavailable');
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [push]);

  const memPct = stats?.memory.percent ?? 0;
  const cpuPct = stats?.cpu.usage ?? 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-semibold font-mono tracking-wide">{t('monitor.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">
            {stats?.platform ?? '…'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            LIVE @ 2s
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            title={paused ? 'resume' : 'pause'}
            className="p-1.5 rounded-lg border border-border hover:border-border-light text-text-muted hover:text-text-primary transition-colors"
          >
            {paused ? <RefreshCw className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* 环形仪表行 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <div className="flex justify-center border border-border bg-bg-card/50 rounded-xl py-4">
          <MetricRing value={cpuPct} color={LEVEL_COLOR(cpuPct)} label={t('monitor.cpu')} />
        </div>
        <div className="flex justify-center border border-border bg-bg-card/50 rounded-xl py-4">
          <MetricRing value={memPct} color={LEVEL_COLOR(memPct)} label={t('monitor.memory')} />
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 border border-border bg-bg-card/50 rounded-xl py-4">
          <Wifi className="w-5 h-5 text-sky-400" />
          <div className="font-mono text-sm text-emerald-400">↓ {stats?.net ? fmtRate(stats.net.rxRate) : '—'}</div>
          <div className="font-mono text-sm text-sky-400">↑ {stats?.net ? fmtRate(stats.net.txRate) : '—'}</div>
          <div className="text-[10px] font-mono text-text-muted">
            {stats?.net ? `${fmtBytes(stats.net.rxTotal)} ↓ / ${fmtBytes(stats.net.txTotal)} ↑` : t('monitor.netHint')}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 border border-border bg-bg-card/50 rounded-xl py-4">
          <Server className="w-5 h-5 text-text-muted" />
          <span className="font-mono text-sm text-text-primary">{stats?.hostname ?? '—'}</span>
          <span className="text-[10px] font-mono text-text-muted">
            {t('monitor.uptime')} {stats ? fmtUptime(stats.uptime) : '—'}
          </span>
          <span className="text-[10px] font-mono text-text-muted">
            {stats?.cpu.cores ?? '—'} cores · load {stats ? stats.cpu.loadAvg.map((l) => l.toFixed(1)).join(' ') : '—'}
          </span>
        </div>
      </div>

      {/* 曲线区 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border bg-bg-card/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-xs font-mono text-text-secondary">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" /> {t('monitor.cpuCurve')}
            </span>
            <span className="text-[10px] font-mono text-text-muted">{cpuPct.toFixed(1)}%</span>
          </div>
          <Sparkline data={cpuHist} color="#9ece6a" max={100} label="cpu" />
        </div>
        <div className="border border-border bg-bg-card/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-xs font-mono text-text-secondary">
              <MemoryStick className="w-3.5 h-3.5 text-amber-400" /> {t('monitor.memCurve')}
            </span>
            <span className="text-[10px] font-mono text-text-muted">{fmtBytes(stats?.memory.used ?? 0)} / {fmtBytes(stats?.memory.total ?? 0)}</span>
          </div>
          <Sparkline data={memHist} color="#e0af68" max={100} label="mem" />
        </div>
        <div className="border border-border bg-bg-card/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-xs font-mono text-text-secondary">
              <Wifi className="w-3.5 h-3.5 text-sky-400" /> {t('monitor.rxCurve')}
            </span>
            <span className="text-[10px] font-mono text-text-muted">{stats?.net ? fmtRate(stats.net.rxRate) : '—'}</span>
          </div>
          <Sparkline data={rxHist} color="#7aa2f7" label="rx" />
        </div>
        <div className="border border-border bg-bg-card/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-xs font-mono text-text-secondary">
              <Wifi className="w-3.5 h-3.5 text-violet-400" /> {t('monitor.txCurve')}
            </span>
            <span className="text-[10px] font-mono text-text-muted">{stats?.net ? fmtRate(stats.net.txRate) : '—'}</span>
          </div>
          <Sparkline data={txHist} color="#bb9af7" label="tx" />
        </div>
      </div>

      {!stats?.net && (
        <p className="mt-4 text-[11px] font-mono text-text-muted">
          ⚠ {t('monitor.netHint')}
        </p>
      )}
    </div>
  );
}
