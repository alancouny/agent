// ── 主题（深色 / 浅色 / 跟随系统 / 极客主题）+ 强调色 ──────────
// Tailwind v4 的工具类引用 CSS 变量（如 bg-bg-dark → var(--color-bg-dark)），
// 运行时覆盖变量即可整站换肤；浅色值定义在 index.css 的 :root[data-theme='light']。

/** 极客主题：深色底 + 霓虹/终端色系（CSS 变量见 index.css）。 */
export const GEEK_THEMES = ['matrix', 'cyberpunk', 'dracula', 'monokai', 'solarized'] as const;
export type GeekTheme = (typeof GEEK_THEMES)[number];

export type ThemePreference = 'system' | 'light' | 'dark' | GeekTheme;

const PREFS_KEY = 'theme_preference';
const ACCENT_KEY = 'theme_accent';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

const media = typeof window !== 'undefined' ? window.matchMedia(SYSTEM_DARK_QUERY) : null;

const VALID: readonly string[] = ['system', 'light', 'dark', ...GEEK_THEMES];

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(PREFS_KEY);
    if (VALID.includes(v as string)) return v as ThemePreference;
  } catch { /* localStorage unavailable */ }
  return 'system';
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(PREFS_KEY, pref);
  } catch { /* localStorage unavailable */ }
  applyTheme(pref);
}

/** 把偏好解析为实际主题（system → 跟随操作系统；极客主题原样返回）。 */
export function resolveTheme(pref: ThemePreference): Exclude<ThemePreference, 'system'> {
  if (pref === 'system') return media?.matches ? 'dark' : 'light';
  return pref;
}

/** 应用主题：data-theme 只会是 light/dark 或某个极客主题名。 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(pref);
}

export function getAccentColor(): string {
  try {
    return localStorage.getItem(ACCENT_KEY) || '#6366f1';
  } catch {
    return '#6366f1';
  }
}

export function setAccentColor(color: string): void {
  try {
    localStorage.setItem(ACCENT_KEY, color);
  } catch { /* localStorage unavailable */ }
  document.documentElement.style.setProperty('--color-primary', color);
}

/** 应用当前偏好（含强调色），并在「跟随系统」时监听系统主题变化。 */
export function initTheme(): void {
  if (typeof window === 'undefined') return;
  applyTheme(getThemePreference());
  setAccentColor(getAccentColor());
  if (!media) return;
  const onChange = () => {
    // 仅当用户选择“跟随系统”时才响应系统切换
    if (getThemePreference() === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
}
