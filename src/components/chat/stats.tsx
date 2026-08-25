// ============================================================
// 自 tick 的实时统计小组件（原 AgentChat.tsx 底部，随拆分移入 chat/ 共享目录）。
//
// 这两个组件各自持有 200-300ms 的 setInterval 并只重渲染自己，
// 把"每秒多次全树重渲染"从 AgentChat 中移除（流式性能关键）。
// ============================================================

import { memo, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';

const formatMs = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

/** 流式徽标：实时 tok/s + 估算 token 数 + 秒数。 */
export const LiveStats = memo(function LiveStats({
  startRef,
  tokensRef,
}: {
  startRef: React.MutableRefObject<number | null>;
  tokensRef: React.MutableRefObject<number>;
}) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick((n) => n + 1), 300);
    return () => clearInterval(iv);
  }, []);

  const elapsedSec = startRef.current ? (performance.now() - startRef.current) / 1000 : 0;
  const tokens = tokensRef.current;
  const tps = tokens > 0 && elapsedSec >= 0.1 ? Math.round(tokens / elapsedSec) : null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-mono px-1.5 py-0.5 bg-amber-500/10 rounded animate-pulse">
      <Gauge className="w-2.5 h-2.5" />
      {tps !== null ? `${tps} tok/s` : '…'}
      <span className="text-text-muted ml-0.5">·</span>
      <span className="text-text-muted">{tokens} tok</span>
      <span className="text-text-muted ml-0.5">·</span>
      <span className="text-text-muted">{elapsedSec.toFixed(1)}s</span>
    </span>
  );
});

/** 思考指示卡片下的 elapsed 秒数。 */
export const ElapsedBadge = memo(function ElapsedBadge({
  startRef,
}: {
  startRef: React.MutableRefObject<number | null>;
}) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick((n) => n + 1), 300);
    return () => clearInterval(iv);
  }, []);

  if (!startRef.current) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1.5 ml-6">
      <Gauge className="w-3 h-3 text-text-muted" />
      <span className="text-[10px] text-text-muted font-mono">
        {formatMs(performance.now() - startRef.current)} elapsed
      </span>
    </div>
  );
});
