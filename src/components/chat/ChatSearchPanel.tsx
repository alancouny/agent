// ============================================================
// ChatSearchPanel — 会话全文搜索面板（原 AgentChat.tsx L766-805 平移）。
// ============================================================

import { useTranslation } from 'react-i18next';
import type { SearchResult } from '../../types';

export interface ChatSearchPanelProps {
  searchQ: string;
  onSearchChange: (q: string) => void;
  onSearch: () => void;
  searching: boolean;
  results: SearchResult[];
  onClear: () => void;
}

export function ChatSearchPanel({
  searchQ,
  onSearchChange,
  onSearch,
  searching,
  results,
  onClear,
}: ChatSearchPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="px-6 py-3 border-b border-border bg-bg-card/30 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchQ}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          placeholder={t('chat.searchPlaceholder')}
          className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary text-sm"
        />
        <button
          onClick={onSearch}
          disabled={searching}
          className="px-3 py-2 rounded-lg bg-primary text-white text-sm disabled:opacity-50"
        >
          {searching ? t('chat.searching') : t('chat.search')}
        </button>
        <button
          onClick={onClear}
          className="px-2 py-2 rounded-lg text-text-secondary hover:bg-bg-hover text-sm"
        >
          {t('chat.clear')}
        </button>
      </div>
      {results.length > 0 && (
        <div className="max-h-48 overflow-auto space-y-1">
          {results.map((r, i) => (
            <div key={i} className="text-xs p-2 rounded bg-bg-card border border-border">
              <span className="text-text-muted mr-2">{r.role}</span>
              <span className="text-text-secondary">{r.content}</span>
            </div>
          ))}
        </div>
      )}
      {searchQ && !searching && results.length === 0 && (
        <p className="text-xs text-text-muted">{t('chat.noResults')}</p>
      )}
    </div>
  );
}
