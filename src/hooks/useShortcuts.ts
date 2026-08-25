import { useEffect } from 'react';
import type { TabType } from '../types';

// ── 可配置快捷键系统 ────────────────────────────────────────
// 默认绑定 + localStorage 持久化 + 冲突检测（同一组合键被两个动作占用）。
// 组合键格式：mod+shift+m（mod = Ctrl on Win/Linux, ⌘ on macOS）。

export const SHORTCUT_KEY = 'shortcuts_bindings_v1';

export interface ShortcutBinding {
  action: string;
  /** 组合键描述，如 'mod+shift+m' */
  key: string;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { action: 'nav.chat', key: 'mod+shift+h' },
  { action: 'nav.monitor', key: 'mod+shift+m' },
  { action: 'nav.git', key: 'mod+shift+g' },
  { action: 'nav.texttools', key: 'mod+shift+t' },
  { action: 'nav.plugins', key: 'mod+shift+p' },
  { action: 'nav.markdown', key: 'mod+shift+k' },
  { action: 'nav.terminal', key: 'mod+shift+`' },
];

export function getBindings(): ShortcutBinding[] {
  try {
    const raw = localStorage.getItem(SHORTCUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShortcutBinding[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* fall through */ }
  return DEFAULT_SHORTCUTS;
}

export function setBindings(bindings: ShortcutBinding[]): void {
  try {
    localStorage.setItem(SHORTCUT_KEY, JSON.stringify(bindings));
  } catch { /* storage full/blocked */ }
}

/** 冲突检测：返回被多个动作占用的组合键列表。 */
export function findConflicts(bindings: ShortcutBinding[]): string[] {
  const seen = new Map<string, string[]>();
  for (const b of bindings) {
    if (!b.key.trim()) continue;
    const arr = seen.get(b.key.trim()) ?? [];
    arr.push(b.action);
    seen.set(b.key.trim(), arr);
  }
  return [...seen.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([key]) => key);
}

/** 把按键事件规范化为组合键字符串（与绑定比较用）。 */
export function eventToKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push('mod');
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  const k = e.key.toLowerCase();
  if (k === ' ') parts.push('space');
  else if (k.length === 1 && /[a-z0-9]/.test(k)) parts.push(k);
  else if (['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'].includes(k)) parts.push(k);
  else if (k.startsWith('arrow')) parts.push(k);
  else if (k === 'escape') parts.push('esc');
  else if (k === 'tab') parts.push('tab');
  else if (k === 'enter') parts.push('enter');
  else return '';
  return parts.join('+');
}

const ACTION_TO_TAB: Record<string, string> = {
  'nav.chat': 'chat',
  'nav.tasks': 'tasks',
  'nav.computer': 'computer',
  'nav.terminal': 'terminal',
  'nav.workspace': 'workspace',
  'nav.skills': 'skills',
  'nav.image': 'image',
  'nav.video': 'video',
  'nav.mcp': 'mcp',
  'nav.models': 'models',
  'nav.tools': 'tools',
  'nav.voice': 'voice',
  'nav.monitor': 'monitor',
  'nav.git': 'git',
  'nav.texttools': 'texttools',
  'nav.plugins': 'plugins',
  'nav.markdown': 'markdown',
  'nav.settings': 'settings',
};

/** 绑定 action → Tab 切换。供 App 使用。 */
export function actionToTab(action: string): TabType | null {
  return (ACTION_TO_TAB[action] as TabType) ?? null;
}

/** 全局快捷键监听：匹配绑定即触发 onAction（返回 false 阻止默认行为）。 */
export function useShortcuts(onAction: (action: string) => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入框/文本域内不劫持（除 Escape 类）
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) && e.key !== 'Escape') {
        return;
      }
      const key = eventToKey(e);
      if (!key) return;
      const binding = getBindings().find((b) => b.key === key);
      if (!binding) return;
      e.preventDefault();
      onAction(binding.action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAction]);
}
