import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings, Cloud, Globe, Plus, Trash2, Edit2, CheckCircle, Loader2, ChevronDown, Shield,
} from 'lucide-react';
import { modelProviderApi, apiFetch } from '../api/client';
import { apiUrl } from '../apiConfig';
import { useAppStore } from '../store/useAppStore';
import type { ModelProvider, ProviderConfig, CustomProviderCreateRequest, ApiSettings } from '../types';
const APPROVAL_STORAGE = 'agent_approval_enabled';

function Toggle({ checked, onChange, label, desc, icon: Icon }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-bg-input/50 rounded-lg border border-border">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${checked ? 'bg-primary/15 text-primary' : 'bg-bg-input text-text-muted'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-muted mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative w-11 h-6 rounded-full transition-colors bg-bg-input border border-border"
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

export function ModelManager({ onSettingsUpdate }: { onSettingsUpdate: (s: ApiSettings) => void }) {
  const { t } = useTranslation();
  // D3：API 配置统一来自全局 store（单一数据源，persist 持久化）
  const settings = useAppStore((s) => s.apiSettings);
  const [approvalEnabled, setApprovalEnabled] = useState(true);

  // ── Provider 管理（原 Settings → Model Providers / Custom Providers）──
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [currentProvider, setCurrentProvider] = useState('');
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider | null>(null);
  const [providerTestResult, setProviderTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [provBusy, setProvBusy] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProvider | null>(null);
  const [providerNote, setProviderNote] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [customFormData, setCustomFormData] = useState<CustomProviderCreateRequest>({
    name: '',
    baseUrl: '',
    apiKeyRequired: false,
    apiKeyHeader: 'Authorization',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/v1/models',
  });

  const note = useCallback((type: 'success' | 'error', message: string) => {
    setProviderNote({ type, message });
    setTimeout(() => setProviderNote(null), 3000);
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const result = await modelProviderApi.getProviders();
      setProviders(result.providers);
      setCurrentProvider(result.currentProvider);
      const configs: Record<string, ProviderConfig> = {};
      for (const p of result.providers) {
        try {
          const cr = await modelProviderApi.getProvider(p.id);
          configs[p.id] = cr.config;
        } catch { /* best-effort per-provider config */ }
      }
      setProviderConfigs(configs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('model.loadProvidersFailed');
      note('error', message);
    }
  }, [t, note]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  const handleConfigChange = async (providerId: string, key: 'apiKey' | 'baseUrl', value: string) => {
    try {
      await modelProviderApi.configureProvider(providerId, { [key]: value });
      setProviderConfigs(prev => ({ ...prev, [providerId]: { ...prev[providerId], [key]: value } }));
      note('success', t('model.configUpdated'));
    } catch {
      note('error', t('model.configFailed'));
    }
  };

  const handleToggleAppendChat = async (providerId: string, enabled: boolean) => {
    try {
      await modelProviderApi.configureProvider(providerId, { autoAppendChat: enabled });
      setProviderConfigs(prev => ({ ...prev, [providerId]: { ...prev[providerId], autoAppendChat: enabled } }));
      note('success', t('model.configUpdated'));
    } catch {
      note('error', t('model.configFailed'));
    }
  };

  const handleSetCurrentProvider = async (providerId: string) => {
    try {
      await modelProviderApi.setCurrentProvider(providerId);
      setCurrentProvider(providerId);
      note('success', t('model.currentUpdated'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('model.setProviderFailed');
      note('error', message);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setProvBusy(true);
    try {
      const r = await modelProviderApi.testConnection(providerId);
      setProviderTestResult({ success: r.success, message: r.message });
    } catch {
      setProviderTestResult({ success: false, message: t('model.testFailed') });
    } finally {
      setProvBusy(false);
    }
  };

  const handleCreateCustomProvider = async () => {
    if (!customFormData.name || !customFormData.baseUrl) {
      note('error', t('model.nameUrlRequired'));
      return;
    }
    try {
      await modelProviderApi.createCustomProvider(customFormData);
      setShowCustomForm(false);
      setCustomFormData({ name: '', baseUrl: '', apiKeyRequired: false, apiKeyHeader: 'Authorization', chatEndpoint: '/chat/completions', modelsEndpoint: '/v1/models' });
      loadProviders();
      note('success', t('model.customCreated'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('model.createFailed');
      note('error', message);
    }
  };

  const handleUpdateCustomProvider = async () => {
    if (!editingProvider) return;
    try {
      await modelProviderApi.updateCustomProvider(editingProvider.id, customFormData);
      setEditingProvider(null);
      setShowCustomForm(false);
      setCustomFormData({ name: '', baseUrl: '', apiKeyRequired: false, apiKeyHeader: 'Authorization', chatEndpoint: '/chat/completions', modelsEndpoint: '/v1/models' });
      loadProviders();
      note('success', t('model.customUpdated'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('model.updateFailed');
      note('error', message);
    }
  };

  const handleDeleteCustomProvider = async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) return;
    try {
      await modelProviderApi.deleteCustomProvider(providerId);
      loadProviders();
      note('success', t('model.customDeleted'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('model.deleteFailed');
      note('error', message);
    }
  };

  useEffect(() => {
    // Load approval state from server
    apiFetch(apiUrl('/api/agent/settings/approval'))
      .then(r => r.json())
      .then(d => setApprovalEnabled(d.approvalRequired !== false))
      .catch(() => {});
  }, []);

  const handleToggleApproval = async (enabled: boolean) => {
    // 关闭审批需二次确认（后端 T02：enabled=false 必须 confirm:true）
    if (!enabled && !window.confirm('关闭后工具调用将无需审批直接执行，确定继续吗？')) return;
    setApprovalEnabled(enabled);
    localStorage.setItem(APPROVAL_STORAGE, String(enabled));
    try {
      await apiFetch(apiUrl('/api/agent/settings/approval'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, confirm: !enabled }),
      });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    onSettingsUpdate(settings);
  }, [settings, onSettingsUpdate]);

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      {/* 页面头 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
          <Settings className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('nav.models')}</h2>
          <p className="text-sm text-text-secondary">{t('model.managerTitle')}</p>
        </div>
      </div>

      {/* ── Model Providers（原 Settings → Model Providers 界面）── */}
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 mb-3">
          <Cloud className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-text-primary">{t('settings.sections.providers')}</h3>
        </div>

        {providerNote && (
          <div className={`mb-3 p-3 rounded-lg text-sm ${providerNote.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
            {providerNote.message}
          </div>
        )}

        <div className="space-y-2">
          {providers.length === 0 && (
            <p className="text-sm text-text-muted">{t('model.noProvidersHint')}</p>
          )}
          {providers.map((p) => {
            const isCurrent = currentProvider === p.id;
            const isSelected = selectedProvider?.id === p.id;
            const cfg = providerConfigs[p.id] || {};
            return (
              <div key={p.id} className={`rounded-xl border transition-colors ${isSelected ? 'border-primary/50 bg-bg-card' : 'border-border bg-bg-card/50'}`}>
                <button
                  onClick={() => setSelectedProvider(isSelected ? null : p)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.type === 'local' ? 'bg-accent/15 text-accent' : 'bg-primary/15 text-primary'}`}>
                      {p.type}
                    </span>
                    <span className="font-medium text-text-primary truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isCurrent && (
                      <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> current
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isSelected && (
                  <div className="px-4 pb-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-secondary mb-1">{t('model.apiKey')}</label>
                        <input
                          type="password"
                          value={cfg.apiKey || ''}
                          onChange={(e) => handleConfigChange(p.id, 'apiKey', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary"
                          placeholder={t('model.apiKeyPh')}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-secondary mb-1">{t('model.baseUrl')}</label>
                        <input
                          type="text"
                          value={cfg.baseUrl || ''}
                          onChange={(e) => handleConfigChange(p.id, 'baseUrl', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary"
                          placeholder={t('model.baseUrlPh')}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cfg.autoAppendChat !== false}
                          onChange={(e) => handleToggleAppendChat(p.id, e.target.checked)}
                          className="accent-primary"
                        />
                        {t('model.autoAppendChat')}
                      </label>
                      <span className="text-xs text-text-muted">{t('model.autoAppendChatDesc')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isCurrent && (
                        <button onClick={() => handleSetCurrentProvider(p.id)}
                          className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs hover:bg-primary-hover transition">
                          {t('model.setCurrent')}
                        </button>
                      )}
                      <button onClick={() => handleTestConnection(p.id)} disabled={provBusy}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-bg-hover transition disabled:opacity-50">
                        {provBusy ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                        {t('common.test')}
                      </button>
                      {providerTestResult && selectedProvider?.id === p.id && (
                        <span className={`text-xs ${providerTestResult.success ? 'text-green-500' : 'text-red-500'}`}>
                          {providerTestResult.message}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Custom Providers（原 Settings → Custom Providers 界面）── */}
      <div className="mt-8 max-w-3xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-text-primary">{t('settings.sections.customProviders')}</h3>
          </div>
          <button
            onClick={() => { setShowCustomForm(!showCustomForm); setEditingProvider(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs hover:bg-primary-hover transition"
          >
            <Plus className="w-3.5 h-3.5" /> {t('common.new')}
          </button>
        </div>

        {showCustomForm && (
          <div className="p-4 rounded-xl bg-bg-card border border-border space-y-3 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('model.nameReq')}</label>
                <input value={customFormData.name} onChange={(e) => setCustomFormData({ ...customFormData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary" placeholder={t('model.customNamePh')} />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('model.baseUrlReq')}</label>
                <input value={customFormData.baseUrl} onChange={(e) => setCustomFormData({ ...customFormData, baseUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary" placeholder="https://api.example.com" />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('model.apiKeyHeader')}</label>
                <input value={customFormData.apiKeyHeader} onChange={(e) => setCustomFormData({ ...customFormData, apiKeyHeader: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={customFormData.apiKeyRequired} onChange={(e) => setCustomFormData({ ...customFormData, apiKeyRequired: e.target.checked })} />
                  {t('model.apiKeyRequired')}
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={editingProvider ? handleUpdateCustomProvider : handleCreateCustomProvider}
                className="px-4 py-2 rounded-lg bg-primary text-white text-xs hover:bg-primary-hover transition">
                {editingProvider ? t('common.save') : t('common.create')}
              </button>
              <button onClick={() => { setShowCustomForm(false); setEditingProvider(null); }}
                className="px-4 py-2 rounded-lg border border-border text-xs text-text-secondary hover:bg-bg-hover transition">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {providers.filter((p) => p.isCustom).length === 0 && (
            <p className="text-sm text-text-muted">{t('model.noCustom')}</p>
          )}
          {providers.filter((p) => p.isCustom).map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border bg-bg-card/50">
              <div className="min-w-0">
                <p className="font-medium text-text-primary truncate">{p.name}</p>
                <p className="text-xs text-text-muted truncate">{p.baseUrl}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditingProvider(p); setCustomFormData({ name: p.name, baseUrl: p.baseUrl || '', apiKeyRequired: p.apiKeyRequired, apiKeyHeader: p.apiKeyHeader || 'Authorization', chatEndpoint: p.chatEndpoint || '/chat/completions', modelsEndpoint: p.modelsEndpoint || '/v1/models' }); setShowCustomForm(true); }}
                  className="p-2 rounded-lg text-text-secondary hover:bg-bg-hover hover:text-text-primary transition">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => handleDeleteCustomProvider(p.id)}
                  className="p-2 rounded-lg text-text-secondary hover:bg-red-500/10 hover:text-red-500 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 审批门（独立安全开关，保留） */}
      <div className="mt-8 max-w-3xl">
        <Toggle
          icon={Shield}
          checked={approvalEnabled}
          onChange={handleToggleApproval}
          label="Tool Approval Gate"
          desc="When OFF, all dangerous tools (click/type/open) run without confirmation"
        />
      </div>
    </div>
  );
}
