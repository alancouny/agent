// ============================================================
// GeneralSection — 通用设置（原 Settings.tsx renderGeneralSection 平移）
// + R4 新增"审批要求"开关（关闭时二次确认，带 confirm:true 调后端）。
// 自带 general/apiBase/apiKey/tts/approval 等 state，写入时机不变。
// ============================================================

import { useEffect, useState } from 'react';
import { Speaker, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTTS } from '../../hooks/useTTS';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { getApiBase, setApiBase } from '../../apiConfig';
import { applyApiBase, agentApi } from '../../api/client';

export interface GeneralSectionProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type GeneralSettings = { animations: boolean; sidebarCollapse: boolean; confirmDelete: boolean; timeout: number; stream: boolean };

function loadGeneral(): GeneralSettings {
  try {
    const raw = localStorage.getItem('gen_settings');
    if (raw) return JSON.parse(raw) as GeneralSettings;
  } catch { /* localStorage unavailable */ }
  return { animations: true, sidebarCollapse: false, confirmDelete: true, timeout: 30, stream: true };
}

function saveGeneral(s: GeneralSettings) {
  try { localStorage.setItem('gen_settings', JSON.stringify(s)); } catch { /* localStorage unavailable */ }
}

export function GeneralSection({ onNotify }: GeneralSectionProps) {
  const { t } = useTranslation();
  const [apiBase, setApiBaseState] = useState<string>(() => getApiBase());
  const [apiSaved, setApiSaved] = useState(false);
  const [apiKey, setApiKey] = useLocalStorage<string>('agent_api_key', '');
  const { settings: ttsSettings, updateSetting: updateTtsSetting, voices: ttsVoices, apiVoices: ttsApiVoices, speechSynthesisAvailable } = useTTS();

  const [general, setGeneral] = useState<GeneralSettings>(loadGeneral);
  const updateGeneral = (key: keyof GeneralSettings, value: boolean | number) => {
    const next = { ...general, [key]: value };
    setGeneral(next);
    saveGeneral(next);
  };

  // ── R4：审批全局开关（持久化后端，关闭需二次确认 confirm:true）──
  const [approvalRequired, setApprovalRequiredState] = useState(true);
  const [approvalBusy, setApprovalBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    agentApi
      .getApprovalRequired()
      .then((r) => { if (!cancelled) setApprovalRequiredState(r.approvalRequired); })
      .catch(() => { /* 后端不可达时保持默认 */ });
    return () => { cancelled = true; };
  }, []);

  const toggleApproval = async (enabled: boolean) => {
    if (approvalBusy) return;
    // 关闭审批是安全敏感操作：二次确认（PRD P1 双保险）
    if (!enabled && !window.confirm(t('settings.approval.confirmDisable'))) return;
    setApprovalBusy(true);
    try {
      const r = await agentApi.setApprovalRequired(enabled, !enabled);
      setApprovalRequiredState(r.approvalRequired);
      onNotify('success', t('common.saved'));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onNotify('error', err?.response?.data?.error || t('common.save') + ' failed');
    } finally {
      setApprovalBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-4">{t('settings.general.title')}</h2>
        <p className="text-text-secondary text-sm">{t('settings.general.subtitle')}</p>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">{t('settings.general.interface')}</h3>

        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <h4 className="font-medium text-text-primary">{t('settings.general.animations')}</h4>
            <p className="text-xs text-text-secondary">{t('settings.general.animationsDesc')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={general.animations} onChange={(e) => updateGeneral('animations', e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
          </label>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <h4 className="font-medium text-text-primary">{t('settings.general.sidebarCollapse')}</h4>
            <p className="text-xs text-text-secondary">{t('settings.general.autoCollapse')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={general.sidebarCollapse} onChange={(e) => updateGeneral('sidebarCollapse', e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
          </label>
        </div>

        <div className="flex items-center justify-between py-3">
          <div>
            <h4 className="font-medium text-text-primary">{t('settings.general.confirmDelete')}</h4>
            <p className="text-xs text-text-secondary">{t('settings.general.confirmDeleteDesc')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={general.confirmDelete} onChange={(e) => updateGeneral('confirmDelete', e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
          </label>
        </div>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">API</h3>

        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <h4 className="font-medium text-text-primary">{t('settings.general.timeout')}</h4>
            <p className="text-xs text-text-secondary">{t('settings.general.timeoutDesc')}</p>
          </div>
          <select
            value={general.timeout}
            onChange={(e) => updateGeneral('timeout', Number(e.target.value))}
            className="px-4 py-2 rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-primary"
          >
            <option value={30}>{t('settings.general.t30')}</option>
            <option value={60}>{t('settings.general.t60')}</option>
            <option value={120}>{t('settings.general.t120')}</option>
            <option value={300}>{t('settings.general.t300')}</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-3">
          <div>
            <h4 className="font-medium text-text-primary">{t('settings.general.stream')}</h4>
            <p className="text-xs text-text-secondary">{t('settings.general.streamDesc')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={general.stream} onChange={(e) => updateGeneral('stream', e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
          </label>
        </div>
      </div>

      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{t('settings.api.title')}</h3>
          <p className="text-xs text-text-secondary mt-1">{t('settings.api.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setApiBaseState('http://localhost:3001')}
            className={`px-3 py-1.5 rounded-lg border text-xs transition ${apiBase === 'http://localhost:3001' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-primary/50'}`}
          >
            {t('settings.api.local')}
          </button>
          <button
            onClick={() => setApiBaseState('')}
            className={`px-3 py-1.5 rounded-lg border text-xs transition ${apiBase === '' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-primary/50'}`}
          >
            {t('settings.api.relative')}
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBaseState(e.target.value)}
            placeholder="https://api.example.com"
            className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-primary transition"
          />
          <button
            onClick={() => { setApiBase(apiBase); applyApiBase(); setApiSaved(true); setTimeout(() => setApiSaved(false), 2000); }}
            className="px-4 py-2 rounded-lg bg-primary text-white text-xs hover:bg-primary-hover transition shrink-0"
          >
            {apiSaved ? t('common.saved') : t('common.save')}
          </button>
        </div>
        <p className="text-xs text-text-muted">{t('settings.api.hint')}</p>
      </div>

      {/* ── R4：审批全局开关（安全加固）── */}
      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-text-primary">{t('settings.approval.title')}</h3>
        </div>
        <p className="text-xs text-text-secondary">{t('settings.approval.desc')}</p>
        <div className="flex items-center justify-between py-2 border-t border-border">
          <div>
            <h4 className="font-medium text-text-primary">{t('settings.approval.require')}</h4>
            <p className="text-xs text-text-secondary">{t('settings.approval.requireDesc')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={approvalRequired}
              disabled={approvalBusy}
              onChange={(e) => void toggleApproval(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400" />
          </label>
        </div>
      </div>

      {/* ── TTS 朗读设置 ── */}
      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Speaker className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-text-primary">{t('tts.speak')}</h3>
        </div>
        <p className="text-xs text-text-secondary">{t('voice.ttsDesc')}</p>

        {/* Provider selection */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div>
            <h4 className="font-medium text-text-primary">TTS Provider</h4>
            <p className="text-xs text-text-secondary">{t('tts.voice')}</p>
          </div>
          <div className="flex gap-2">
            {(['browser-native', 'tts-api'] as const).map((mode) => {
              const disabled = mode === 'browser-native' && !speechSynthesisAvailable;
              return (
                <button
                  key={mode}
                  disabled={disabled}
                  onClick={() => !disabled && updateTtsSetting('mode', mode)}
                  title={disabled ? 'Web Speech API not available in this browser' : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition ${
                    disabled
                      ? 'border-border text-text-muted cursor-not-allowed opacity-50'
                      : ttsSettings.mode === mode
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-primary/50'
                  }`}
                >
                  {t(`tts.${mode}`)}
                  {disabled && <span className="ml-1 text-[10px]">·</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Voice selector */}
        {(ttsSettings.mode === 'browser-native' ? ttsVoices : ttsApiVoices).length > 0 && (
          <div className="flex items-center justify-between py-2">
            <div>
              <h4 className="font-medium text-text-primary">{t('tts.voice')}</h4>
              <p className="text-xs text-text-secondary">
                {ttsSettings.mode === 'browser-native'
                  ? `${ttsVoices.length} voices available`
                  : `${ttsApiVoices.length} voices available`}
              </p>
            </div>
            <select
              value={ttsSettings.voice}
              onChange={(e) => updateTtsSetting('voice', e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-primary max-w-[260px]"
            >
              {(ttsSettings.mode === 'browser-native' ? ttsVoices : ttsApiVoices).map((v) => {
                // TtsVoice（id）与 SpeechSynthesisVoice（voiceURI/lang）字段不互通，按 in 收窄取 key
                const key = 'voiceURI' in v ? (v.voiceURI || v.name) : (v.id || v.name);
                const lang = 'lang' in v ? v.lang : undefined;
                return (
                  <option key={key} value={key}>
                    {v.name}
                    {lang ? ` (${lang})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Read thinking toggle */}
        <div className="flex items-center justify-between py-2 border-t border-border">
          <div>
            <h4 className="font-medium text-text-primary">{t('tts.readThinking')}</h4>
            <p className="text-xs text-text-secondary">{t('tts.readThinkingDesc')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={ttsSettings.readThinking}
              onChange={(e) => updateTtsSetting('readThinking', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
          </label>
        </div>
      </div>

      <div className="p-6 rounded-xl bg-red-500/5 border border-red-500/20">
        <h3 className="text-lg font-semibold text-red-400 mb-2">{t('settings.apiKey.title')}</h3>
        <p className="text-text-secondary text-sm mb-3">{t('settings.apiKey.desc')}</p>
        <label className="block text-xs text-text-muted mb-1">{t('settings.apiKey.inputLabel')}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary font-mono"
        />
      </div>

      <div className="p-6 rounded-xl bg-accent/10 border border-accent/20">
        <h3 className="text-lg font-semibold text-accent mb-2">{t('settings.general.about')}</h3>
        <p className="text-text-secondary text-sm mb-3">
          Version 1.0.0 - A powerful multi-modal AI agent application
        </p>
        <p className="text-text-muted text-xs">
          Built with React, TypeScript, Vite, and Express
        </p>
      </div>
    </div>
  );
}
