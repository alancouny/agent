import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  eventToKey,
  findConflicts,
  getBindings,
  setBindings,
  actionToTab,
  SHORTCUT_KEY,
} from '../useShortcuts';

describe('useShortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('eventToKey normalizes modifier combinations', () => {
    expect(eventToKey({ metaKey: true, shiftKey: true, key: 'm' } as KeyboardEvent)).toBe('mod+shift+m');
    expect(eventToKey({ ctrlKey: true, key: 'g' } as KeyboardEvent)).toBe('ctrl+g');
    expect(eventToKey({ shiftKey: true, key: ' ' } as KeyboardEvent)).toBe('shift+space');
    expect(eventToKey({ key: 'ArrowUp' } as KeyboardEvent)).toBe('arrowup');
    expect(eventToKey({ key: 'Escape' } as KeyboardEvent)).toBe('esc');
    expect(eventToKey({ key: 'F5' } as KeyboardEvent)).toBe(''); // 未支持的功能键
  });

  it('findConflicts detects the same key bound to two actions', () => {
    const conflicts = findConflicts([
      { action: 'nav.chat', key: 'mod+shift+h' },
      { action: 'nav.git', key: 'mod+shift+h' },
      { action: 'nav.monitor', key: 'mod+shift+m' },
    ]);
    expect(conflicts).toEqual(['mod+shift+h']);
  });

  it('findConflicts ignores empty keys', () => {
    expect(findConflicts([{ action: 'a', key: '' }, { action: 'b', key: '  ' }])).toEqual([]);
  });

  it('persists bindings to localStorage and reads them back', () => {
    const custom = [{ action: 'nav.git', key: 'mod+alt+g' }];
    setBindings(custom);
    expect(localStorage.getItem(SHORTCUT_KEY)).toBe(JSON.stringify(custom));
    expect(getBindings()).toEqual(custom);
  });

  it('falls back to defaults when storage is empty or corrupt', () => {
    expect(getBindings()).toEqual(DEFAULT_SHORTCUTS);
    localStorage.setItem(SHORTCUT_KEY, '{not json');
    expect(getBindings()).toEqual(DEFAULT_SHORTCUTS);
  });

  it('default shortcuts map to the new geek panels', () => {
    const actions = new Set(DEFAULT_SHORTCUTS.map((s) => s.action));
    expect(actions.has('nav.monitor')).toBe(true);
    expect(actions.has('nav.git')).toBe(true);
    expect(actions.has('nav.texttools')).toBe(true);
    expect(actions.has('nav.plugins')).toBe(true);
    expect(actions.has('nav.markdown')).toBe(true);
    // 无重复键
    expect(findConflicts(DEFAULT_SHORTCUTS)).toEqual([]);
  });

  it('actionToTab maps nav actions to tabs', () => {
    expect(actionToTab('nav.monitor')).toBe('monitor');
    expect(actionToTab('nav.git')).toBe('git');
    expect(actionToTab('nav.markdown')).toBe('markdown');
    expect(actionToTab('unknown.action')).toBeNull();
  });
});
