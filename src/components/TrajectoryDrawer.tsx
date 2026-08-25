import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../utils/logger';
import {
  X, User, Bot, Wrench, CheckCircle2, AlertCircle, Layers, ChevronDown, ChevronRight,
  Send, GitBranch, FileText, ShieldAlert,
} from 'lucide-react';
import { agentApi } from '../api/client';

interface TrajEvent {
  seq: number;
  turnIdx: number;
  stepIdx: number;
  type: string;
  role?: string;
  content?: string;
  toolName?: string;
  args?: string;
  result?: string;
  model?: string;
  tokens?: string;
  createdAt?: string;
}

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  turn_start: { label: 'trajectory.evt.turn_start', icon: Layers, color: 'text-primary' },
  user_message: { label: 'trajectory.evt.user_message', icon: User, color: 'text-blue-500' },
  steer: { label: 'trajectory.evt.steer', icon: GitBranch, color: 'text-purple-500' },
  context_injected: { label: 'trajectory.evt.context_injected', icon: FileText, color: 'text-teal-500' },
  model_call: { label: 'trajectory.evt.model_call', icon: Bot, color: 'text-primary' },
  text: { label: 'trajectory.evt.text', icon: Bot, color: 'text-primary' },
  tool_call: { label: 'trajectory.evt.tool_call', icon: Wrench, color: 'text-orange-500' },
  tool_result: { label: 'trajectory.evt.tool_result', icon: CheckCircle2, color: 'text-green-500' },
  approval_pending: { label: 'trajectory.evt.approval_pending', icon: ShieldAlert, color: 'text-yellow-500' },
  approval_resolved: { label: 'trajectory.evt.approval_resolved', icon: ShieldAlert, color: 'text-yellow-500' },
  complete: { label: 'trajectory.evt.complete', icon: CheckCircle2, color: 'text-green-500' },
  error: { label: 'trajectory.evt.error', icon: AlertCircle, color: 'text-red-500' },
};

export function TrajectoryDrawer({
  sessionId,
  onClose,
  onSteered,
}: {
  sessionId: string;
  onClose: () => void;
  onSteered: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ turns: { turnIdx: number; steps: { stepIdx: number; events: TrajEvent[] }[] }[] } | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [steerText, setSteerText] = useState('');
  const [steering, setSteering] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await agentApi.trajectory(sessionId);
        if (cancelled) return;
        // agentApi.trajectory 返回的 TrajectoryEvent 带宽松索引签名，转为本组件局部类型
        setData({
          turns: res.turns.map((t) => ({
            turnIdx: t.turnIdx,
            steps: t.steps.map((s) => ({ stepIdx: s.stepIdx, events: s.events as unknown as TrajEvent[] })),
          })),
        });
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    poll();
    const iv = setInterval(poll, 5000); // live-refresh while the agent is running
    return () => {
      cancelled = true; // 卸载后不再 setState
      clearInterval(iv);
    };
     
  }, [sessionId]);

  const toggleStep = (key: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const doSteer = async () => {
    if (!steerText.trim() || steering) return;
    setSteering(true);
    try {
      await agentApi.steer(sessionId, steerText);
      onSteered(steerText);
      setSteerText('');
    } catch (err: unknown) {
      // 失败时给出可见反馈，避免未处理 rejection
      logger.error('[TrajectoryDrawer] steer failed', err);
    } finally {
      setSteering(false);
    }
  };

  const fmtArgs = (s?: string) => {
    if (!s) return '';
    try {
      const obj = JSON.parse(s);
      return JSON.stringify(obj, null, 2);
    } catch {
      return s;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl h-full bg-bg-card border-l border-border flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              {t('trajectory.title')}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {t('trajectory.subtitle')}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Steering box */}
        <div className="px-4 py-3 border-b border-border bg-bg-input/40">
          <div className="text-xs font-medium text-text-secondary mb-1.5">
            Steering — 发送给正在运行的 Agent，它会在下一步之前注入
          </div>
          <div className="flex gap-2">
            <input
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSteer()}
              placeholder={t('trajectory.steerPlaceholderDetail')}
              className="flex-1 px-3 py-2 rounded-lg bg-bg-card border border-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
            />
            <button
              onClick={doSteer}
              disabled={steering || !steerText.trim()}
              className="px-3 py-2 rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 flex items-center gap-1.5 text-sm"
            >
              <Send className="w-3.5 h-3.5" /> {t('trajectory.steer')}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading && !data ? (
            <p className="text-text-muted text-sm">Loading trajectory…</p>
          ) : !data || data.turns.length === 0 ? (
            <p className="text-text-muted text-sm">{t('trajectory.empty')}</p>
          ) : (
            data.turns.map((turn) => (
              <div key={turn.turnIdx} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-text-primary uppercase tracking-wide">
                  <Layers className="w-3.5 h-3.5" /> {t('trajectory.turn')} {turn.turnIdx}
                </div>
                {turn.steps.map((step) => {
                  const key = `${turn.turnIdx}-${step.stepIdx}`;
                  const expanded = expandedSteps.has(key);
                  const first = step.events[0];
                  const summary = step.events
                    .map((e) => e.type === 'tool_call' ? `🔧 ${e.toolName}` : e.type === 'model_call' ? `🧠 ${e.model || ''}` : e.type)
                    .join(' · ');
                  return (
                    <div key={key} className="border border-border rounded-xl overflow-hidden bg-bg-card/60">
                      <button
                        onClick={() => toggleStep(key)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-bg-input/40 transition-colors"
                      >
                        <span className="text-sm text-text-secondary truncate">
                          <span className="text-text-muted text-xs">{t('trajectory.step')} {step.stepIdx}</span>
                          {first && TYPE_META[first.type] ? (
                            <span className={`inline-flex items-center gap-1 ml-2 ${TYPE_META[first.type].color}`}>
                              {React.createElement(TYPE_META[first.type].icon, { className: 'w-3 h-3' })}
                              {summary}
                            </span>
                          ) : (
                            <span className="ml-2">{summary || '…'}</span>
                          )}
                        </span>
                        {expanded ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
                      </button>
                      {expanded && (
                        <div className="px-3 pb-3 space-y-2">
                          {step.events.map((ev) => {
                            const meta = TYPE_META[ev.type] || { label: ev.type, icon: FileText, color: 'text-text-secondary' };
                            return (
                              <div key={ev.seq} className="text-xs bg-bg-input/40 rounded-lg px-3 py-2">
                                <div className={`flex items-center gap-1.5 font-medium ${meta.color}`}>
                                  {React.createElement(meta.icon, { className: 'w-3 h-3' })}
                                  {t(meta.label)}
                                  {ev.model && <span className="text-text-muted">· {ev.model}</span>}
                                  {ev.tokens && (() => {
                                    try {
                                      const t = JSON.parse(ev.tokens);
                                      return <span className="text-text-muted">· {t.totalTokens ?? ''} tok</span>;
                                    } catch { return null; }
                                  })()}
                                </div>
                                {ev.type === 'context_injected' && ev.content && (
                                  <div className="text-text-secondary mt-1">{ev.content}</div>
                                )}
                                {ev.content && ev.type !== 'context_injected' && (
                                  <pre className="mt-1 text-text-primary whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{ev.content}</pre>
                                )}
                                {ev.args && ev.type === 'tool_call' && (
                                  <pre className="mt-1 text-text-secondary whitespace-pre-wrap font-mono text-[11px] bg-black/20 rounded p-2">{fmtArgs(ev.args)}</pre>
                                )}
                                {ev.result && ev.type === 'tool_result' && (
                                  <pre className="mt-1 text-text-muted whitespace-pre-wrap font-mono text-[11px] max-h-24 overflow-y-auto">{ev.result}</pre>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
