import { describe, it, expect, beforeEach } from 'vitest';
import {
  getThemePreference,
  setThemePreference,
  resolveTheme,
  applyTheme,
  getAccentColor,
  setAccentColor,
} from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.removeProperty('--color-primary');
  });

  it('defaults to system when nothing is stored', () => {
    expect(getThemePreference()).toBe('system');
  });

  it('persists the preference and applies data-theme', () => {
    setThemePreference('light');
    expect(getThemePreference()).toBe('light');
    expect(localStorage.getItem('theme_preference')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    setThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolveTheme maps system to light when the OS is light (mock matchMedia: dark=false)', () => {
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('applyTheme resolves system before writing data-theme', () => {
    applyTheme('system');
    // matchMedia mock 返回 matches: false → 解析为 light
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('rejects invalid stored values and falls back to system', () => {
    localStorage.setItem('theme_preference', 'banana');
    expect(getThemePreference()).toBe('system');
  });

  it('accent color persists and is applied to the CSS variable', () => {
    expect(getAccentColor()).toBe('#6366f1');
    setAccentColor('#10b981');
    expect(getAccentColor()).toBe('#10b981');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#10b981');
  });
});
