import { describe, it, expect } from 'vitest';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';
import { bo } from './locales/bo';
import { fa } from './locales/fa';

const LOCALES: Record<string, Record<string, string>> = {
  en,
  ja,
  ko,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  bo,
  fa,
};

const keys = (l: Record<string, string>) => Object.keys(l).sort();

/**
 * 键对齐门禁：en 是 source of truth，其余 6 种语言必须与 en 键集完全一致。
 * 缺键会让界面显示 key 字面量；多键说明有死翻译。漂移在 CI 即被拦截。
 */
describe('i18n key alignment', () => {
  const enKeys = keys(en);

  it('en has no duplicate keys', () => {
    expect(new Set(enKeys).size).toBe(enKeys.length);
  });

  for (const [code, locale] of Object.entries(LOCALES)) {
    if (code === 'en') continue;
    it(`${code} has exactly the same keys as en`, () => {
      const localeKeys = keys(locale);
      const missing = enKeys.filter((k) => !localeKeys.includes(k));
      const extra = localeKeys.filter((k) => !enKeys.includes(k));
      expect(missing, `${code} missing keys: ${missing.join(', ')}`).toEqual([]);
      expect(extra, `${code} extra keys: ${extra.join(', ')}`).toEqual([]);
    });
  }

  it('no locale uses the broken ${var} interpolation syntax', () => {
    for (const [code, locale] of Object.entries(LOCALES)) {
      for (const [k, v] of Object.entries(locale)) {
        expect(v, `${code}.${k}`).not.toMatch(/\$\{[^}]+\}/);
      }
    }
  });
});
