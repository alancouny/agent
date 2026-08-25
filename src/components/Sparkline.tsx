import { memo, useMemo } from 'react';

// ── Sparkline：轻量 SVG 迷你折线图（零依赖）─────────────────
// 用于系统监控的 CPU/内存/网络历史曲线，支持渐变填充与峰值标注。

export const Sparkline = memo(function Sparkline({
  data,
  width = 240,
  height = 56,
  color = '#7aa2f7',
  max,
  min,
  label,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  max?: number;
  min?: number;
  label?: string;
}) {
  const { path, area, hi, lo, last } = useMemo(() => {
    if (!data.length) return { path: '', area: '', hi: 0, lo: 0, last: 0 };
    const hiV = max ?? Math.max(...data);
    const loV = min ?? Math.min(...data, 0);
    const span = hiV - loV || 1;
    const step = width / Math.max(data.length - 1, 1);
    const pts = data.map((v, i) => [i * step, height - 4 - ((v - loV) / span) * (height - 8)]);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPath = `${line} L${width},${height} L0,${height} Z`;
    return {
      path: line,
      area: areaPath,
      hi: hiV,
      lo: loV,
      last: data[data.length - 1],
    };
  }, [data, width, height, max, min]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-[56px] text-[10px] text-text-muted font-mono">
        collecting…
      </div>
    );
  }

  return (
    <div className="relative">
      <svg width={width} height={height} className="block" role="img" aria-label={label}>
        <defs>
          <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={width} cy={height - 4 - ((last - lo) / (hi - lo || 1)) * (height - 8)} r="2" fill={color} />
      </svg>
      <span className="absolute bottom-0.5 left-1 text-[9px] font-mono text-text-muted">
        {label ? `${label} ` : ''}
        {hi.toFixed(0)}
      </span>
    </div>
  );
});

/** 环形仪表（CPU/内存百分比）。 */
export const MetricRing = memo(function MetricRing({
  value,
  size = 92,
  stroke = 8,
  color,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease', filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-lg font-semibold" style={{ color }}>
          {Math.round(pct)}
          <span className="text-[10px] text-text-muted ml-0.5">%</span>
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-widest text-text-muted font-mono">{label}</span>
    </div>
  );
});
