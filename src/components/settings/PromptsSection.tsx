// ============================================================
// PromptsSection — 提示词库（原 Settings.tsx renderPromptsSection 平移）。
// 自带 prompts/prompt* 等 state 与增删改逻辑，行为不变。
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Edit2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { promptsApi } from '../../api/client';

export interface PromptsSectionProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function PromptsSection({ onNotify }: PromptsSectionProps) {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<{ id: string; name: string; content: string; version: number; variables: string[] }[]>([]);
  const [promptsError, setPromptsError] = useState('');
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptEditingId, setPromptEditingId] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const data = await promptsApi.list();
      setPrompts(data.prompts || []);
      setPromptsError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('kb.promptUnreachable');
      setPromptsError(message);
    }
  }, [t]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const save = async () => {
    if (!promptName.trim() || !promptContent.trim()) {
      onNotify('error', 'Name and promptContent required');
      return;
    }
    try {
      if (promptEditingId) {
        await promptsApi.update(promptEditingId, promptName, promptContent);
        onNotify('success', 'Prompt updated');
      } else {
        await promptsApi.add(promptName, promptContent);
        onNotify('success', 'Prompt added');
      }
      setPromptName(''); setPromptContent(''); setPromptEditingId(null);
      loadPrompts();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onNotify('error', err?.response?.data?.error || t('common.save') + ' failed');
    }
  };

  const edit = (p: { id: string; name: string; content: string }) => {
    setPromptEditingId(p.id); setPromptName(p.name); setPromptContent(p.content);
  };

  const remove = async (id: string) => {
    try {
      await promptsApi.remove(id);
      onNotify('success', 'Prompt deleted');
      loadPrompts();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onNotify('error', err?.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-4">{t('settings.sections.prompts')}</h2>
        <p className="text-text-secondary text-sm">
          Reusable prompts. Use <code className="mx-1 px-1 bg-bg-input rounded">{'{{variable}}'}</code> for templated fields.
        </p>
      </div>
      {promptsError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />
            {promptsError} — 请确认后端已启动
          </div>
          <button onClick={() => { setPromptsError(''); loadPrompts(); }}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-500 text-xs hover:bg-red-500/30 transition">
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="p-6 rounded-xl bg-bg-card border border-border space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">{promptEditingId ? t('kb.editPrompt') : t('kb.newPrompt')}</h3>
        <input
          type="text"
          value={promptName}
          onChange={(e) => setPromptName(e.target.value)}
          placeholder="Name (e.g. Code Reviewer)"
          className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
        />
        <textarea
          value={promptContent}
          onChange={(e) => setPromptContent(e.target.value)}
          placeholder={t('kb.promptContentPh')}
          rows={6}
          className="w-full px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary font-mono text-sm"
        />
        <div className="flex justify-end gap-2">
          {promptEditingId && (
            <button
              onClick={() => { setPromptEditingId(null); setPromptName(''); setPromptContent(''); }}
              className="px-4 py-2 rounded-lg border border-border text-text-secondary hover:bg-bg-hover"
            >
              Cancel
            </button>
          )}
          <button
            onClick={save}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            {promptEditingId ? t('common.save') : t('kb.add')}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-3">{t('kb.prompts', { count: prompts.length })}</h3>
        {prompts.length === 0 ? (
          <p className="text-text-muted text-sm">{t('kb.noPrompts')}</p>
        ) : (
          <div className="space-y-2">
            {prompts.map((p) => (
              <div key={p.id} className="p-4 rounded-xl bg-bg-card border border-border flex items-center justify-between">
                <div className="min-w-0">
                  <h4 className="font-medium text-text-primary">{p.name}</h4>
                  <p className="text-xs text-text-secondary truncate">{p.content.slice(0, 80)}</p>
                  {p.variables.length > 0 && (
                    <p className="text-xs text-accent mt-1">vars: {p.variables.join(', ')} · v{p.version}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => edit(p)} className="p-2 rounded-lg text-text-secondary hover:bg-bg-hover hover:text-text-primary">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(p.id)} className="p-2 rounded-lg text-text-secondary hover:bg-red-500/10 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
