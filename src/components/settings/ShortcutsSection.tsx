// ============================================================
// ShortcutsSection — 快捷键绑定（原 Settings.tsx renderShortcutsSection 平移）。
// 自带 shortcutBindings/recordingIdx state 与录制 useEffect，写入时机不变。
// ============================================================

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getBindings, setBindings, findConflicts, DEFAULT_SHORTCUTS, eventToKey,
} from '../../hooks/useShortcuts';

export function ShortcutsSection() {
  const { t } = useTranslation();
  const [shortcutBindings, setShortcutBindings] = useState(() => getBindings());
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null);

  // 录制快捷键：按下组合键即写入
  useEffect(() => {
    if (recordingIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = eventToKey(e);
      if (!key || key === 'esc') {
        setRecordingIdx(null);
        return;
      }
      setShortcutBindings((prev) => {
        const next = prev.map((b, i) => (i === recordingIdx ? { ...b, key } : b));
        setBindings(next);
        return next;
      });
      setRecordingIdx(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [recordingIdx]);

  const conflicts = new Set(findConflicts(shortcutBindings));
  const formatKey = (k: string) =>
    k.split('+').map((p) => (p === 'mod' ? '⌘' : p === 'ctrl' ? '⌃' : p === 'alt' ? '⌥' : p === 'shift' ? '⇧' : p.toUpperCase())).join(' ');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-2">{t('settings.shortcuts.title')}</h2>
        <p className="text-text-secondary text-sm">{t('settings.shortcuts.subtitle')}</p>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary">{t('settings.shortcuts.bindings')}</h3>
          <button
            onClick={() => {
              setShortcutBindings(DEFAULT_SHORTCUTS);
              setBindings(DEFAULT_SHORTCUTS);
            }}
            className="text-sm text-sky-400 hover:underline"
          >
            {t('settings.shortcuts.reset')}
          </button>
        </div>
        <div className="space-y-2">
          {shortcutBindings.map((b, i) => {
            const isConflict = conflicts.has(b.key);
            return (
              <div key={b.action} className="flex items-center gap-3 py-1.5">
                <span className="w-44 text-sm text-text-primary font-mono">{b.action.replace('nav.', '')}</span>
                <button
                  onClick={() => setRecordingIdx(i)}
                  className={`flex-1 max-w-xs px-3 py-1.5 rounded-lg border font-mono text-sm text-center transition-colors ${
                    recordingIdx === i
                      ? 'border-primary text-primary bg-primary/10 animate-pulse'
                      : isConflict
                        ? 'border-red-500/50 text-red-400 bg-red-500/10'
                        : 'border-border text-text-secondary hover:border-border-light'
                  }`}
                >
                  {recordingIdx === i ? 'press keys… (esc to cancel)' : formatKey(b.key)}
                </button>
                {isConflict && (
                  <span className="text-[11px] text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {t('settings.shortcuts.conflict')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-text-muted">{t('settings.shortcuts.hint')}</p>
      </div>
    </div>
  );
}
