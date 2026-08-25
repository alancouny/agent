// ============================================================
// ChatMessageList — 消息区 + 虚拟滚动 + TTS 错误 + thinking + 审批卡。
// 内含 memo 化的 MessageRow（评审 #10：memo + 时间格式化缓存）。
// 由 AgentChat 容器传入虚拟化实例与滚动 refs，行为与拆分前逐像素一致。
// ============================================================

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, User, Wrench, Speaker, Pause, Loader2, Gauge, Shield } from 'lucide-react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { Message } from '../../types';
import { LiveStats, ElapsedBadge } from './stats';
import { ToolApprovalCard } from './ToolApprovalCard';
import type { StreamUsage, PendingApproval } from './types';

export interface ChatMessageListProps {
  messages: Message[];
  useVirtual: boolean;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  ttsError: string | null;
  thinking: string;
  elapsedStartRef: React.MutableRefObject<number | null>;
  streamingTokensRef: React.MutableRefObject<number>;
  pendingApproval: PendingApproval | null;
  onApprove: (approvalKey: string) => void;
  onDeny: (approvalKey: string) => void;
  streamUsage: StreamUsage | null;
  playingId: string | null;
  isPaused: boolean;
  onSpeak: (id: string, text: string) => void;
  onStopSpeak: () => void;
}

const formatNum = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export interface MessageRowProps {
  message: Message;
  streamUsage: StreamUsage | null;
  playingId: string | null;
  isPaused: boolean;
  onSpeak: (id: string, text: string) => void;
  onStopSpeak: () => void;
  elapsedStartRef: React.MutableRefObject<number | null>;
  streamingTokensRef: React.MutableRefObject<number>;
}

/** 单条消息行（memo：仅当 message/统计/TTS 状态变化时重渲染）。 */
export const MessageRow = memo(function MessageRow({
  message,
  streamUsage,
  playingId,
  isPaused,
  onSpeak,
  onStopSpeak,
  elapsedStartRef,
  streamingTokensRef,
}: MessageRowProps) {
  const { t } = useTranslation();
  // 时间格式化缓存：timestamp 引用不变则复用格式化结果（评审 #10）
  const timeLabel = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);

  return (
    <div className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          message.role === 'user'
            ? 'bg-primary'
            : message.role === 'tool'
            ? 'bg-amber-500/20'
            : 'bg-bg-hover'
        }`}
      >
        {message.role === 'user' ? (
          <User className="w-5 h-5 text-white" />
        ) : message.role === 'tool' ? (
          <Wrench className="w-5 h-5 text-amber-500" />
        ) : (
          <Bot className="w-5 h-5 text-primary" />
        )}
      </div>
      <div className={`max-w-[80%] ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-3 rounded-2xl ${
            message.role === 'user'
              ? 'bg-primary text-white rounded-tr-md'
              : message.role === 'tool'
              ? 'bg-amber-500/10 text-text-primary border border-amber-500/20 rounded-md text-xs font-mono'
              : 'bg-bg-card text-text-primary rounded-tl-md'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        <p className="text-xs text-text-secondary mt-1 ml-2">{timeLabel}</p>
        {message.role === 'assistant' && (
          <div className="flex items-center gap-3 mt-1 ml-2">
            {/* 流式过程中：实时 tok/s + token 数 + 秒数（子组件自 tick，不拖累整树） */}
            {message.isStreaming && <LiveStats startRef={elapsedStartRef} tokensRef={streamingTokensRef} />}
            {/* 响应完成后：显示真实 usage 统计 */}
            {streamUsage && !message.isStreaming && (
              <>
                <span className="inline-flex items-center gap-1 text-[10px] text-text-muted font-mono px-1.5 py-0.5 bg-bg-darker rounded">
                  <span className="text-purple-400">↑</span>
                  {streamUsage.promptTokens > 0 ? `${formatNum(streamUsage.promptTokens)} prompt` : ''}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-text-muted font-mono px-1.5 py-0.5 bg-bg-darker rounded">
                  <span className="text-emerald-400">↓</span>
                  {formatNum(streamUsage.completionTokens)} completion
                  <span className="text-text-muted ml-1">(total {formatNum(streamUsage.totalTokens)})</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-text-muted font-mono px-1.5 py-0.5 bg-bg-darker rounded">
                  <Gauge className="w-2.5 h-2.5 text-amber-400" />
                  {streamUsage.tokensPerSecond} tok/s
                </span>
                <span className="text-[10px] text-text-muted font-mono">
                  ({streamUsage.elapsedSeconds}s)
                </span>
              </>
            )}
            {/* 朗读按钮 — 仅对非流式、有文本内容的助手消息显示 */}
            {!message.isStreaming && message.content && (
              <button
                onClick={() => {
                  if (playingId === message.id) onStopSpeak();
                  else onSpeak(message.id, message.content);
                }}
                title={playingId === message.id ? (isPaused ? t('tts.playing') : t('tts.stop')) : t('tts.speak')}
                className={`p-1 rounded transition-colors ${
                  playingId === message.id
                    ? 'text-primary hover:text-primary-hover'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {playingId === message.id ? (
                  isPaused ? <Speaker className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5 animate-pulse" />
                ) : (
                  <Speaker className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export function ChatMessageList({
  messages,
  useVirtual,
  virtualizer,
  scrollRef,
  endRef,
  ttsError,
  thinking,
  elapsedStartRef,
  streamingTokensRef,
  pendingApproval,
  onApprove,
  onDeny,
  streamUsage,
  playingId,
  isPaused,
  onSpeak,
  onStopSpeak,
}: ChatMessageListProps) {
  const rowProps = (message: Message) => ({
    message,
    streamUsage,
    playingId,
    isPaused,
    onSpeak,
    onStopSpeak,
    elapsedStartRef,
    streamingTokensRef,
  });

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      {useVirtual ? (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const message = messages[vi.index];
            if (!message) return null;
            return (
              <div
                key={message.id}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <div className="pb-4"><MessageRow {...rowProps(message)} /></div>
              </div>
            );
          })}
        </div>
      ) : (
        messages.map((message) => (
          <div key={message.id} className="pb-4">
            <MessageRow {...rowProps(message)} />
          </div>
        ))
      )}

      {/* TTS 错误提示 */}
      {ttsError && (
        <div className="flex justify-center py-2">
          <span className="text-xs text-red-400 bg-red-500/10 px-3 py-1 rounded-full">{ttsError}</span>
        </div>
      )}

      {/* Thinking indicator */}
      {thinking && (
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-bg-hover">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
          <div className="bg-bg-card text-text-secondary rounded-2xl rounded-tl-md px-4 py-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{thinking}</span>
            </div>
            <ElapsedBadge startRef={elapsedStartRef} />
          </div>
        </div>
      )}

      {/* Approval card */}
      {pendingApproval && (
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-500/20">
            <Shield className="w-5 h-5 text-amber-500" />
          </div>
          <ToolApprovalCard pendingApproval={pendingApproval} onApprove={onApprove} onDeny={onDeny} />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
