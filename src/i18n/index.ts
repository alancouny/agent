// ── i18n 初始化：7 种语言，默认英语 ──────────────────────────
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';
import { bo } from './locales/bo';
import { fa } from './locales/fa';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ja', label: '日本語', dir: 'ltr' },
  { code: 'ko', label: '한국어', dir: 'ltr' },
  { code: 'zh-CN', label: '简体中文', dir: 'ltr' },
  { code: 'zh-TW', label: '繁體中文', dir: 'ltr' },
  { code: 'bo', label: 'བོད་ཡིག', dir: 'ltr' },
  { code: 'fa', label: 'فارسی', dir: 'rtl' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const STORAGE_KEY = 'language_preference';

export function getLanguagePreference(): LanguageCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && SUPPORTED_LANGUAGES.some((l) => l.code === v)) return v as LanguageCode;
  } catch { /* localStorage unavailable */ }
  return 'en'; // 默认英语
}

export function setLanguagePreference(code: LanguageCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch { /* localStorage unavailable */ }
  void i18n.changeLanguage(code);
  applyDocLang(code);
}

/** 设置 <html lang> 与文字方向（波斯语为 RTL）。 */
export function applyDocLang(code: LanguageCode): void {
  if (typeof document === 'undefined') return;
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = lang?.dir === 'rtl' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    ko: { translation: ko },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    bo: { translation: bo },
    fa: { translation: fa },
  },
  lng: getLanguagePreference(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React 已转义
});

// 初始化后同步 <html lang>/dir（i18n 的 lng 与 DOM 属性保持一致）。
applyDocLang(getLanguagePreference());

export default i18n;
