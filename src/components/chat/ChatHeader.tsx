// ============================================================
// ChatHeader — 顶部工具栏（原 AgentChat.tsx L634-724 平移）。
// 纯展示：所有状态与回调由 AgentChat 容器传入。
// ============================================================

import { Bot, RefreshCw, Copy, Search, Layers, Workflow, FileText, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContextUsageBar } from '../ContextUsageBar';
import type { ContextUsage } from '../../types';

export interface ChatHeaderProps {
  toolCount: number;
  showTools: boolean;
  onToggleTools: () => void;
  onClear: () => void;
  onFork: () => void;
  canFork: boolean;
  showSearch: boolean;
  onToggleSearch: () => void;
  showTrajectory: boolean;
  onToggleTrajectory: () => void;
  canTrajectory: boolean;
  workflowMode: boolean;
  onToggleWorkflow: () => void;
  fileTrackerEnabled: boolean;
  onToggleFileTracker: () => void;
  trackedFileCount: number;
  ctxUsage: ContextUsage;
  model: string;
  streaming: boolean;
  contextCompressed: boolean;
}

export function ChatHeader({
  toolCount,
  showTools,
  onToggleTools,
  onClear,
  onFork,
  canFork,
  showSearch,
  onToggleSearch,
  showTrajectory,
  onToggleTrajectory,
  canTrajectory,
  workflowMode,
  onToggleWorkflow,
  fileTrackerEnabled,
  onToggleFileTracker,
  trackedFileCount,
  ctxUsage,
  model,
  streaming,
  contextCompressed,
}: ChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-bg-card/50">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        <span className="font-medium text-text-primary">AI Agent</span>
      </div>
      <div className="flex items-center gap-2 ml-2">
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{t('chat.supportTools')}</span>
      </div>
      <ContextUsageBar
        usage={ctxUsage}
        model={model}
        streaming={streaming}
        compressed={contextCompressed}
        className="hidden lg:block ml-1"
      />
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleTools}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            showTools ? 'bg-primary text-white' : 'bg-bg-card text-text-secondary hover:text-text-primary'
          }`}
          title={t('tools.title')}
        >
          <Wrench className="w-4 h-4" />
          <span>{toolCount}</span>
        </button>
        <button
          onClick={onClear}
          className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t('chat.newChat')}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={onFork}
          disabled={!canFork}
          className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
          title={t('chat.branch')}
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleSearch}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            showSearch ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
          title={t('chat.searchChat')}
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleTrajectory}
          disabled={!canTrajectory}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-40 ${
            showTrajectory ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
          title={t('chat.trajectory')}
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleWorkflow}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            workflowMode ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
          title={t('chat.workflow')}
        >
          <Workflow className="w-4 h-4" />
          <span className="hidden lg:inline">{t('chat.workflowLabel')}</span>
        </button>
        <button
          onClick={onToggleFileTracker}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            fileTrackerEnabled
              ? 'bg-primary text-white shadow-sm shadow-primary/20'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
          title={fileTrackerEnabled ? t('chat.fileTrackerDisable') : t('chat.fileTrackerEnable')}
        >
          <FileText className="w-4 h-4" />
          {trackedFileCount > 0 && (
            <span className={`min-w-[18px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold ${
              fileTrackerEnabled ? 'bg-white/20' : 'bg-primary/20 text-primary'
            }`}>
              {trackedFileCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
