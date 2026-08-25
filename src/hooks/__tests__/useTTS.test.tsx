/**
 * Tests for useTTS hook — specifically the localStorage ↔ focus sync mechanism
 * that keeps multiple components (AgentChat, Settings) sharing the same settings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTTS } from '../useTTS';

// ── Helpers ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'tts_settings';

function setTtsInStorage(value: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function clearTtsStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Simulate a window focus event (triggers the sync useEffect in useTTS). */
function triggerFocus() {
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
}

// ── Fixes ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  clearTtsStorage();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearTtsStorage();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe('useTTS', () => {
  it('reads initial settings from localStorage on mount', () => {
    setTtsInStorage({ mode: 'tts-api', voice: 'alloy', readThinking: true });
    const { result } = renderHook(() => useTTS());
    expect(result.current.settings).toEqual({
      mode: 'tts-api',
      voice: 'alloy',
      readThinking: true,
    });
  });

  it('returns defaults when localStorage is empty', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.settings.mode).toBe('browser-native');
    expect(result.current.settings.readThinking).toBe(false);
  });

  // ── Focus-sync: simulate Settings panel changing readThinking ──────────────
  it('picks up updated readThinking after focus event (Settings → AgentChat sync)', () => {
    // AgentChat mounts with readThinking=false (default)
    const { result } = renderHook(() => useTTS());
    expect(result.current.settings.readThinking).toBe(false);

    // Settings panel changes readThinking=true and writes to localStorage
    act(() => {
      setTtsInStorage({ mode: 'browser-native', voice: '', readThinking: true });
    });

    // AgentChat regains focus → sync fires → settings should update
    triggerFocus();
    expect(result.current.settings.readThinking).toBe(true);
  });

  it('picks up updated voice after focus event', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.settings.voice).toBe('');

    act(() => {
      setTtsInStorage({ mode: 'tts-api', voice: 'shimmer', readThinking: false });
    });
    triggerFocus();
    expect(result.current.settings.voice).toBe('shimmer');
  });

  it('picks up updated mode after focus event', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.settings.mode).toBe('browser-native');

    act(() => {
      setTtsInStorage({ mode: 'tts-api', voice: 'alloy', readThinking: false });
    });
    triggerFocus();
    expect(result.current.settings.mode).toBe('tts-api');
  });

  it('does not re-render when settings are identical after focus', () => {
    setTtsInStorage({ mode: 'browser-native', voice: '', readThinking: false });
    const { result, rerender } = renderHook(() => useTTS());
    const initialSettings = result.current.settings;

    triggerFocus();
    rerender(); // forces re-render to check if settings changed
    expect(result.current.settings).toBe(initialSettings);
  });

  it('updates settings in all components that call useTTS independently', () => {
    // Simulate two separate hook instances (e.g. AgentChat + Settings)
    const { result: agentResult } = renderHook(() => useTTS());
    const { result: settingsResult } = renderHook(() => useTTS());

    expect(agentResult.current.settings.readThinking).toBe(false);
    expect(settingsResult.current.settings.readThinking).toBe(false);

    // User toggles in Settings component
    act(() => {
      settingsResult.current.updateSetting('readThinking', true);
    });
    // Settings writes to localStorage via the hook's saveSettings useEffect
    // Simulate by writing directly
    setTtsInStorage({ mode: 'browser-native', voice: '', readThinking: true });

    // AgentChat regains focus
    triggerFocus();
    expect(agentResult.current.settings.readThinking).toBe(true);
    // Settings still has the latest too
    expect(settingsResult.current.settings.readThinking).toBe(true);
  });
});
