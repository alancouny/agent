import { useState, useEffect } from 'react';
import { apiUrl } from '../apiConfig';
import { useTranslation } from 'react-i18next';
import {
  BookOpen, Plus, Trash2, Edit3, Save, Loader2,
} from 'lucide-react';
import { logger } from '../utils/logger';
import { apiFetch } from '../api/client';

interface Skill {
  id: string;
  name: string;
  description: string;
  when: string;
  steps: string[];
  createdAt?: string;
  updatedAt?: string;
}

const API = '/api/skills';
const skillsUrl = (p: string) => apiUrl(API + p);

async function getSkills(): Promise<Skill[]> {
  const res = await apiFetch(API);
  const data = await res.json();
  return data.skills || [];
}

export function SkillsPanel() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Skill | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', description: '', when: '', steps: '' });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setSkills(await getSkills());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleSaveNew = async () => {
    if (!newSkill.name) return;
    setBusy(true);
    try {
      const res = await apiFetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newSkill, steps: newSkill.steps.split('\n').filter(s => s.trim()) }),
      });
      if (!res.ok) throw new Error('Save failed');
      setShowAdd(false);
      setNewSkill({ name: '', description: '', when: '', steps: '' });
      await refresh();
    } catch (err) {
      logger.error('Skills save failed', err);
    } finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await apiFetch(skillsUrl(`/${id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setViewing(null);
      await refresh();
    } catch (err: unknown) {
      logger.error('Skills delete failed', err);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await apiFetch(skillsUrl(`/${editing.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name,
          description: editing.description,
          when: editing.when,
          steps: editing.steps,
        }),
      });
      if (!res.ok) throw new Error('Update failed');
      setEditing(null);
      setViewing(null);
      await refresh();
    } catch (err: unknown) {
      logger.error('Skills update failed', err);
    } finally { setBusy(false); }
  };

  const editMode = (s: Skill) => (
    <div className="space-y-3">
      <input
        value={s.name}
        onChange={e => setEditing({ ...s, name: e.target.value })}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary text-lg font-bold"
      />
      <textarea
        value={s.description}
        onChange={e => setEditing({ ...s, description: e.target.value })}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary text-sm"
        rows={2}
      />
      <textarea
        value={s.when}
        onChange={e => setEditing({ ...s, when: e.target.value })}
        placeholder={t('skills.whenPh')}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary text-sm"
        rows={2}
      />
      <textarea
        value={s.steps.join('\n')}
        onChange={e => setEditing({ ...s, steps: e.target.value.split('\n').filter(x => x.trim()) })}
        placeholder={t('skills.stepsPh')}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary text-sm font-mono"
        rows={6}
      />
      <div className="flex gap-2">
        <button onClick={handleSaveEdit} disabled={busy} className="px-4 py-2 bg-primary text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50">
          <Save className="w-4 h-4" /> Save
        </button>
        <button onClick={() => setEditing(null)} className="px-4 py-2 border border-border text-text-secondary rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">{t('skills.title')}</h2>
            <p className="text-sm text-text-secondary">
              {skills.length} skills loaded &mdash; injected into the agent as procedures
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-4 h-4" /> New Skill
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-auto flex-1">
        {skills.map(skill => (
          <div
            key={skill.id}
            className="bg-bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => setViewing(viewing?.id === skill.id ? null : skill)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-text-primary">{skill.name}</h3>
                </div>
                <p className="text-sm text-text-secondary mt-1">{skill.description}</p>
                <div className="flex items-center gap-2 mt-3 text-xs text-text-muted">
                  <span className="px-2 py-0.5 bg-bg-darker rounded">{skill.steps.length} steps</span>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(skill); }}
                  className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(skill.id); }}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            {viewing?.id === skill.id && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="mb-3">
                  <p className="text-xs text-text-muted uppercase mb-1">{t('skills.trigger')}</p>
                  <p className="text-sm text-text-secondary">{skill.when}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase mb-2">{t('skills.steps')}</p>
                  <ol className="space-y-1">
                    {skill.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-dark border border-border rounded-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="text-lg font-bold text-text-primary">{t('skills.new')}</h3>
            <input
              value={newSkill.name}
              onChange={e => setNewSkill({ ...newSkill, name: e.target.value })}
              placeholder={t('skills.namePh')}
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
            />
            <textarea
              value={newSkill.description}
              onChange={e => setNewSkill({ ...newSkill, description: e.target.value })}
              placeholder="What does this skill do?"
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
              rows={2}
            />
            <textarea
              value={newSkill.when}
              onChange={e => setNewSkill({ ...newSkill, when: e.target.value })}
              placeholder={t('skills.whenPh')}
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
              rows={2}
            />
            <textarea
              value={newSkill.steps}
              onChange={e => setNewSkill({ ...newSkill, steps: e.target.value })}
              placeholder={t('skills.stepsPh')}
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
              rows={4}
            />
            <div className="flex gap-2">
              <button onClick={handleSaveNew} disabled={busy} className="px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50">{t('common.create')}</button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-border text-text-secondary rounded-lg">{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-dark border border-border rounded-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="text-lg font-bold text-text-primary">{t('skills.edit')}：{editing.name}</h3>
            {editMode(editing)}
          </div>
        </div>
      )}
    </div>
  );
}
