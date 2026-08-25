// ============================================================
// ThemeSection — 主题偏好 + 强调色（原 Settings.tsx renderThemeSection 平移）。
// 自带 themePref/accentColor state，写入 localStorage 时机不变。
// ============================================================

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getThemePreference,
  setThemePreference,
  getAccentColor,
  setAccentColor,
  type ThemePreference,
} from '../../theme';

export function ThemeSection() {
  const { t } = useTranslation();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const [accentColor, setAccentColorState] = useState<string>(() => getAccentColor());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-4">{t('settings.theme.title')}</h2>
        <p className="text-text-secondary text-sm">{t('settings.theme.subtitle')}</p>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border">
        <h3 className="text-lg font-semibold text-text-primary mb-4">{t('settings.theme.colorScheme')}</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { id: 'system' as ThemePreference, name: t('settings.theme.system'), desc: t('settings.theme.system'), colors: ['#0f172a', '#f1f5f9', '#ffffff'] },
            { id: 'light' as ThemePreference, name: t('settings.theme.light'), desc: t('settings.theme.light'), colors: ['#ffffff', '#f1f5f9', '#e2e8f0'] },
            { id: 'dark' as ThemePreference, name: t('settings.theme.dark'), desc: t('settings.theme.dark'), colors: ['#0f172a', '#1e293b', '#020617'] },
            { id: 'matrix' as ThemePreference, name: 'Matrix', desc: 'black on green · terminal rain', colors: ['#0a0f0a', '#00ff41', '#55ff88'] },
            { id: 'cyberpunk' as ThemePreference, name: 'Cyberpunk', desc: 'neon pink × electric cyan', colors: ['#0d0221', '#ff2a6d', '#05d9e8'] },
            { id: 'dracula' as ThemePreference, name: 'Dracula', desc: 'deep purple · classic', colors: ['#282a36', '#bd93f9', '#ff79c6'] },
            { id: 'monokai' as ThemePreference, name: 'Monokai', desc: 'high-contrast yellow/pink', colors: ['#272822', '#a6e22e', '#f92672'] },
            { id: 'solarized' as ThemePreference, name: 'Solarized', desc: 'low-saturation warm dark', colors: ['#002b36', '#268bd2', '#b58900'] },
          ].map((theme) => {
            const active = themePref === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  setThemePref(theme.id);
                  setThemePreference(theme.id);
                }}
                className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                  active ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-border hover:border-border-hover'
                }`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1">
                    {theme.colors.map((color, i) => (
                      <div key={i} className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  <span className="font-medium text-text-primary">{theme.name}</span>
                </div>
                <p className="text-xs text-text-secondary mb-2">{theme.desc}</p>
                {active && (
                  <div className="flex items-center gap-1 text-xs text-primary">
                    <Check className="w-3 h-3" /> Active
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          {t('settings.theme.dark')}
        </p>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border">
        <h3 className="text-lg font-semibold text-text-primary mb-4">{t('settings.theme.accent')}</h3>

        <div className="flex flex-wrap gap-3">
          {[
            { color: '#6366f1', name: t('settings.accent.indigo') },
            { color: '#8b5cf6', name: t('settings.accent.violet') },
            { color: '#ec4899', name: t('settings.accent.pink') },
            { color: '#f59e0b', name: t('settings.accent.amber') },
            { color: '#10b981', name: t('settings.accent.emerald') },
            { color: '#3b82f6', name: t('settings.accent.blue') },
          ].map((accent) => (
            <button
              key={accent.color}
              onClick={() => {
                setAccentColorState(accent.color);
                setAccentColor(accent.color);
              }}
              className={`w-10 h-10 rounded-full border-2 transition-all duration-200 ${
                accentColor === accent.color
                  ? 'border-text-primary scale-110 shadow-lg'
                  : 'border-transparent hover:scale-110'
              }`}
              style={{ backgroundColor: accent.color }}
              title={accent.name}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">{t('settings.theme.accent')}</p>
      </div>
    </div>
  );
}
