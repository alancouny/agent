// ============================================================
// ToolApprovalCard — 待审批工具卡（原 AgentChat.tsx L864-891 平移）。
// ============================================================

import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PendingApproval } from './types';

export interface ToolApprovalCardProps {
  pendingApproval: PendingApproval;
  onApprove: (approvalKey: string) => void;
  onDeny: (approvalKey: string) => void;
}

export function ToolApprovalCard({ pendingApproval, onApprove, onDeny }: ToolApprovalCardProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl rounded-tl-md px-4 py-3 max-w-md w-full">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-medium text-amber-400">{t('chat.approvalPending', { toolName: pendingApproval.toolName })}</span>
        <span className="text-xs text-text-muted ml-auto">{t('chat.timeout', { seconds: 120 })}</span>
      </div>
      <p className="text-xs text-text-secondary mb-1">
        {t('chat.toolRequest', { toolName: pendingApproval.toolName })}
      </p>
      <pre className="text-[10px] text-text-muted bg-bg-dark rounded p-2 mb-3 overflow-auto max-h-20 whitespace-pre-wrap">
        {JSON.stringify(pendingApproval.args, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(pendingApproval.approvalKey)}
          className="flex-1 px-3 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition"
        >
          {t('chat.approve')}
        </button>
        <button
          onClick={() => onDeny(pendingApproval.approvalKey)}
          className="flex-1 px-3 py-1.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition"
        >
          {t('chat.deny')}
        </button>
      </div>
    </div>
  );
}
