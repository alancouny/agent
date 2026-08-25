// ============================================================
// ChatInput — 输入区（原 AgentChat.tsx L902-970 平移）。
// 含 AutoRun / 思考模式开关 + textarea + 发送/停止按钮。
// ============================================================

import { Send, XCircle, Brain, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isLoading: boolean;
  onSend: () => void;
  onStop: () => void;
  autoRun: boolean;
  onToggleAutoRun: () => void;
  thinkingMode: boolean;
  onToggleThinkingMode: () => void;
  toolCount: number;
}

export function ChatInput({
  input,
  onInputChange,
  onKeyDown,
  isLoading,
  onSend,
  onStop,
  autoRun,
  onToggleAutoRun,
  thinkingMode,
  onToggleThinkingMode,
  toolCount,
}: ChatInputProps) {
  const { t } = useTranslation();

  return (
    <div className="p-4 border-t border-border bg-bg-card/50">
      {/* AutoRun toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-text-muted">
          {t('chat.toolCount', { count: toolCount })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleThinkingMode}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              thinkingMode
                ? 'bg-primary/20 text-primary border border-primary/40 shadow-sm shadow-primary/20'
                : 'bg-bg-hover text-text-secondary border border-border hover:text-text-primary'
            }`}
            title={t('chat.thinkingModeHint')}
          >
            <Brain className={`w-3.5 h-3.5 ${thinkingMode ? 'fill-current' : ''}`} />
            {t('chat.thinkingMode')}
          </button>
          <button
            onClick={onToggleAutoRun}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              autoRun
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm shadow-amber-500/20'
                : 'bg-bg-hover text-text-secondary border border-border hover:text-text-primary'
            }`}
            title={autoRun ? t('chat.autorunOn') : t('chat.autorunOff')}
          >
            <Zap className={`w-3.5 h-3.5 ${autoRun ? 'fill-current' : ''}`} />
            AutoRun
          </button>
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1 relative">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chat.placeholder')}
            className="w-full px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-primary transition-colors"
            rows={2}
            disabled={isLoading}
          />
        </div>
        {isLoading ? (
          <button
            onClick={onStop}
            className="p-3 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-all duration-200 shadow-lg shadow-red-500/25"
            title={t('chat.stop')}
          >
            <XCircle className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim()}
            title={t('chat.send')}
            className="p-3 rounded-xl bg-primary text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-primary/25"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className="mt-2 text-xs text-text-secondary text-center">
        {t('chat.toolCount', { count: toolCount })}
      </div>
    </div>
  );
}
