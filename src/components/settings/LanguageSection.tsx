// ============================================================
// LanguageSection — 界面语言（原 Settings.tsx renderLanguageSection 平移）。
// 自带 langPref state，写入 localStorage 时机不变。
// ============================================================

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  SUPPORTED_LANGUAGES,
  getLanguagePreference,
  setLanguagePreference,
  type LanguageCode,
} from '../../i18n';

export function LanguageSection() {
  const { t } = useTranslation();
  const [langPref, setLangPref] = useState<LanguageCode>(() => getLanguagePreference());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-4">{t('settings.language.title')}</h2>
        <p className="text-text-secondary text-sm">{t('settings.language.subtitle')}</p>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = langPref === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => {
                  setLangPref(lang.code);
                  setLanguagePreference(lang.code);
                }}
                className={`p-4 rounded-xl border-2 transition-all duration-200 flex items-center justify-between gap-2 ${
                  active
                    ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                    : 'border-border hover:border-border-hover'
                }`}
              >
                <span className="font-medium text-text-primary text-sm">{lang.label}</span>
                {active && <Check className="w-4 h-4 text-primary" />}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          {t('settings.language.english')} · {t('settings.language.japanese')} ·{' '}
          {t('settings.language.korean')} · {t('settings.language.simplifiedChinese')} ·{' '}
          {t('settings.language.traditionalChinese')} · {t('settings.language.tibetan')} ·{' '}
          {t('settings.language.persian')}
        </p>
      </div>
    </div>
  );
}
