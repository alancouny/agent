// ============================================================
// ToolsBadgePanel — 工具面板（原 AgentChat.tsx L744-763 平移）。
// ============================================================

import { useTranslation } from 'react-i18next';
import type { AgentTool } from '../../types';

export interface ToolsBadgePanelProps {
  tools: AgentTool[];
}

const getToolIcon = (toolName: string): string => {
  const icons: Record<string, string> = {
    calculator: '🔢',
    web_search: '🌐',
    read_file: '📖',
    write_file: '✏️',
    execute_code: '💻',
    weather: '🌤️',
    current_time: '🕐',
  };
  return icons[toolName] || '🔧';
};

export function ToolsBadgePanel({ tools }: ToolsBadgePanelProps) {
  const { t } = useTranslation();

  return (
    <div className="px-6 py-3 border-b border-border bg-bg-card/30">
      <div className="text-xs text-text-secondary mb-2">{t('chat.availableTools', { count: tools.length })}</div>
      <div className="flex flex-wrap gap-2">
        {tools.map(tool => (
          <div
            key={tool.name}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-card border border-border rounded-md text-xs"
            title={tool.description}
          >
            <span>{getToolIcon(tool.name)}</span>
            <span className="text-text-primary">{tool.name}</span>
            {tool.requiresApproval && (
              <span className="text-yellow-500" title={t('chat.waitingApproval')}>⚠️</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
