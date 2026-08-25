import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Info } from 'lucide-react';
import type { ContextUsage } from '../types';

interface ContextUsageBarProps {
  usage: ContextUsage | null;
  model: string;
  /** 流式加载中：进度条脉冲 + 呼吸圆点，强调“实时” */
  streaming: boolean;
  /** 自适应上下文压缩已触发：显示压缩徽标 */
  compressed?: boolean;
  className?: string;
}

const fmtShort = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const fmtFull = (n: number): string => n.toLocaleString();

type Level = 'ok' | 'warn' | 'danger';

function levelOf(percent: number): Level {
  if (percent >= 80) return 'danger';
  if (percent >= 50) return 'warn';
  return 'ok';
}

const FILL: Record<Level, string> = {
  ok: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
  warn: 'bg-gradient-to-r from-amber-400 to-orange-500',
  danger: 'bg-gradient-to-r from-red-500 to-rose-500',
};
const TEXT: Record<Level, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
};

/**
 * 上下文窗口使用情况指示器：
 *  - 常驻聊天头部，流式加载时进度条平滑增长（width transition + pulse）
 *  - 颜色分级：<50% 绿 / 50-80% 黄 / ≥80% 红
 *  - 点击展开详情（输入/输出/累计用量/数据来源）
 */
export const ContextUsageBar = memo(function ContextUsageBar({ usage, model, streaming, compressed = false, className = '' }: ContextUsageBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const hasData = !!usage && (usage.contextUsed > 0 || usage.cumulative.total > 0);
  const percent = usage?.percent ?? 0;
  const level = levelOf(percent);
  const used = usage?.contextUsed ?? 0;
  const windowSize = usage?.contextWindow ?? 0;

  // 无数据：展示占位（流式中显示 “…” 脉冲）
  if (!hasData) {
    return (
      <button
        onClick={() => setOpen(false)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-muted border border-border bg-bg-card/50 hover:text-text-secondary hover:border-border-light transition-colors ${className}`}
        title={t('contextUsage.title')}
      >
        <Gauge className="w-3.5 h-3.5" />
        <span className="font-mono whitespace-nowrap">
          上下文 {streaming ? <span className="animate-pulse">…</span> : '--'}
        </span>
        {streaming && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
      </button>
    );
  }

  const fillWidth = Math.max(percent, streaming ? 6 : 0); // 流式时至少保留一格

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-card/50 border border-border hover:border-border-light transition-colors"
        title={t('contextUsage.titleDetail')}
      >
        <Gauge className={`w-3.5 h-3.5 ${TEXT[level]}`} />
        <span className="text-xs text-text-secondary font-mono whitespace-nowrap">
          {fmtShort(used)}
          <span className="text-text-muted">/{windowSize ? fmtShort(windowSize) : '?'}</span>
        </span>
        <div className="w-16 h-1.5 rounded-full bg-bg-hover overflow-hidden">
          <div
            className={`h-full rounded-full ${FILL[level]} transition-all duration-500 ease-out ${streaming ? 'animate-pulse' : ''}`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
        <span className={`text-[10px] font-mono ${TEXT[level]} whitespace-nowrap`}>
          {percent.toFixed(1)}%
        </span>
        {compressed && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-400 font-medium" title={t('contextUsage.compressedTitle')}>
            {t('contextUsage.compressedBadge')}
          </span>
        )}
        {streaming && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 p-3 rounded-xl bg-bg-elevated border border-border shadow-xl z-50 text-xs space-y-1.5 animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center gap-1.5 text-text-muted mb-1">
            <Info className="w-3 h-3" />
            <span>{t('contextUsage.windowTitle')}</span>
            {streaming && (
              <span className="ml-auto inline-flex items-center gap-1 text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                streaming
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('contextUsage.model')}</span>
            <span className="font-mono text-text-primary truncate max-w-[13rem]" title={model}>{model}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('contextUsage.currentContext')}</span>
            <span className="font-mono text-text-primary">{fmtFull(used)} tokens</span>
          </div>
          <div className="flex items-center justify-between pl-4">
            <span className="text-text-muted">· {t('contextUsage.inputPrompt')}</span>
            <span className="font-mono text-text-secondary">{fmtFull(usage?.contextPrompt ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between pl-4">
            <span className="text-text-muted">· {t('contextUsage.outputCompletion')}</span>
            <span className="font-mono text-text-secondary">{fmtFull(usage?.contextCompletion ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('contextUsage.windowSize')}</span>
            <span className="font-mono text-text-primary">{windowSize ? fmtFull(windowSize) : t('contextUsage.unknown')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('contextUsage.usageRate')}</span>
            <span className={`font-mono ${TEXT[level]}`}>{percent.toFixed(1)}%</span>
          </div>

          <div className="border-t border-border my-1" />

          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('contextUsage.sessionCumulative')}</span>
            <span className="font-mono text-text-primary">{fmtFull(usage?.cumulative.total ?? 0)} tokens</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">{t('contextUsage.dataSource')}</span>
            <span className="font-mono text-text-secondary">{t('contextUsage.source.' + (usage?.source ?? 'none'))}</span>
          </div>
          {compressed && (
            <div className="flex items-center justify-between text-violet-400">
              <span className="text-text-secondary">{t('contextUsage.compressedLabel')}</span>
              <span className="font-mono text-xs">{t('contextUsage.compressedActive')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
