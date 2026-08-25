import { describe, it, expect, beforeEach } from 'vitest';
import i18n, {
  getLanguagePreference,
  setLanguagePreference,
  applyDocLang,
  SUPPORTED_LANGUAGES,
} from './index';

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to English when nothing is stored', () => {
    expect(getLanguagePreference()).toBe('en');
    expect(i18n.language.startsWith('en')).toBe(true);
  });

  it('persists the choice and switches translations live', () => {
    setLanguagePreference('zh-CN');
    expect(getLanguagePreference()).toBe('zh-CN');
    expect(localStorage.getItem('language_preference')).toBe('zh-CN');
    expect(i18n.t('nav.chat')).toBe('对话');

    setLanguagePreference('ja');
    expect(i18n.t('nav.chat')).toBe('チャット');

    setLanguagePreference('ko');
    expect(i18n.t('nav.settings')).toBe('설정');
  });

  it('supports all requested languages', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(['en', 'ja', 'ko', 'zh-CN', 'zh-TW', 'bo', 'fa']);
  });

  it('sets RTL direction for Persian and LTR otherwise', () => {
    applyDocLang('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('fa');

    applyDocLang('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('returns the key itself for missing keys (graceful fallback)', () => {
    setLanguagePreference('ja');
    // i18next 对缺失 key 默认返回 key 本身，界面不会出现空白
    expect(i18n.t('some.missing.key')).toBe('some.missing.key');
  });

  it('rejects invalid stored values and falls back to en', () => {
    localStorage.setItem('language_preference', 'xx');
    expect(getLanguagePreference()).toBe('en');
  });
});
