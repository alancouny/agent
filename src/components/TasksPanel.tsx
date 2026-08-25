import { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl } from '../apiConfig';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api/client';
import {
  ListTodo,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Clock,
  Filter,
} from 'lucide-react';

interface TaskStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  order: number;
  startedAt?: string;
  completedAt?: string;
}

interface TaskItem {
  id: string;
  sessionId?: string;
  title: string;
  description?: string;
  status: 'pending' | 'planning' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps: TaskStep[];
}

interface TaskFilters {
  status?: string;
  search?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400',
  planning: 'text-blue-400',
  running: 'text-green-400',
  paused: 'text-orange-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
};

const STEP_COLORS: Record<string, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-400',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  skipped: 'bg-orange-400',
};

async function tasksApi(path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await apiFetch(apiUrl(`/api/tasks${path}`), opts);
  return res.json();
}

export function TasksPanel() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<TaskFilters>({});
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      const data = await tasksApi(`?${params.toString()}`);
      setTasks(data.tasks || []);
      setLoadError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('tasks.loadFailed');
      setTasks([]);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [filter.status, t]);

  useEffect(() => { void fetchTasks(); }, [fetchTasks]);

  // 轮询用 ref 持最新 fetchTasks（interval 依赖 [] 会捕获首帧闭包，filter 永远用初始值）
  const fetchRef = useRef(fetchTasks);
  fetchRef.current = fetchTasks;
  useEffect(() => {
    const interval = setInterval(() => { void fetchRef.current(); }, 3000);
    return () => clearInterval(interval);
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAction = async (taskId: string, endpoint: string) => {
    await tasksApi(`/${taskId}${endpoint}`, 'POST');
    fetchTasks();
  };

  const handleDelete = async (taskId: string) => {
    await tasksApi(`/${taskId}`, 'DELETE');
    fetchTasks();
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    await tasksApi('', 'POST', {
      title: newTaskTitle.trim(),
      description: newTaskDesc.trim(),
    });
    setNewTaskTitle('');
    setNewTaskDesc('');
    setShowNewForm(false);
    fetchTasks();
  };

  const handleAddStep = async (taskId: string) => {
    const idx = tasks.findIndex(t => t.id === taskId);
    await tasksApi(`/${taskId}/steps`, 'POST', { title: `Step ${idx >= 0 ? tasks[idx].steps.length + 1 : 1}` });
    fetchTasks();
  };

  const handleStatusFilter = (status: string) => {
    setFilter(prev => ({ ...prev, status: prev.status === status ? undefined : status }));
    setStatusMenuOpen(false);
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      pending: t('tasks.status.pending'),
      planning: t('tasks.status.planning'),
      running: t('tasks.status.running'),
      paused: t('tasks.status.paused'),
      completed: t('tasks.status.completed'),
      failed: t('tasks.status.failed'),
      skipped: t('tasks.status.skipped'),
    };
    return map[s] || s;
  };

  const timeAgo = (ts?: string) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('tasks.justNow');
    if (mins < 60) return `${mins}${t('tasks.minAgo')}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}${t('tasks.hrAgo')}`;
    return `${Math.floor(hrs / 24)}${t('tasks.dayAgo')}`;
  };

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
          <XCircle className="w-10 h-10 text-error" />
          <p className="text-text-secondary text-sm">{loadError}</p>
          <p className="text-text-muted text-xs">{t('tasks.backendHint')}</p>
          <button
            onClick={() => { setLoading(true); setLoadError(''); fetchTasks(); }}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover transition"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border-dark">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <ListTodo className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">{t('tasks.title')}</h2>
            <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">{tasks.length}</span>
          </div>
          <div className="flex items-center gap-2">
            {tasks.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-secondary hover:text-text-primary border border-border-dark hover:border-border-light transition"
                >
                  <Filter className="w-3 h-3" />
                  Filter
                </button>
                {statusMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-bg-elevated border border-border-dark rounded-lg shadow-lg overflow-hidden min-w-[140px]">
                    {['pending', 'planning', 'running', 'paused', 'completed', 'failed'].map(s => (
                      <button
                        key={s}
                        onClick={() => handleStatusFilter(s)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hint flex items-center gap-2 ${filter.status === s ? 'bg-accent/10 text-accent' : 'text-text-secondary'}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s].replace('text-', 'bg-')}`} />
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setShowNewForm(!showNewForm)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 transition"
            >
              <Plus className="w-3 h-3" />
              New Task
            </button>
          </div>
        </div>

        {showNewForm && (
          <div className="mt-3 p-3 bg-bg-elevated border border-border-dark rounded-lg space-y-2">
            <input
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              placeholder={t('tasks.titlePlaceholder')}
              className="w-full px-3 py-1.5 text-sm bg-bg-dark border border-border-dark rounded text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && handleCreateTask()}
            />
            <input
              value={newTaskDesc}
              onChange={e => setNewTaskDesc(e.target.value)}
              placeholder={t('tasks.descPlaceholder')}
              className="w-full px-3 py-1.5 text-sm bg-bg-dark border border-border-dark rounded text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewForm(false)} className="px-3 py-1 text-xs text-text-muted hover:text-text-primary transition">{t('common.cancel')}</button>
              <button onClick={handleCreateTask} className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/90 transition">{t('common.create')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ListTodo className="w-12 h-12 text-border-dark mb-4" />
            <p className="text-text-muted text-sm mb-2">{t('tasks.empty')}</p>
            <p className="text-text-muted text-xs text-center max-w-xs">
              Tasks are auto-created when Agent starts complex work, or you can create one manually.
            </p>
          </div>
        ) : (
          tasks.map(task => (
            <div key={task.id} className="bg-bg-elevated border border-border-dark rounded-xl overflow-hidden hover:border-border-light transition">
              {/* Task header */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-bg-hint/50 transition"
                onClick={() => toggleExpand(task.id)}
              >
                <button className="flex-shrink-0">
                  {expanded[task.id] ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                </button>

                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLORS[task.status]?.replace('text-', 'bg-') || 'bg-gray-500'}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">{task.title}</span>
                    <span className={`text-xs ${STATUS_COLORS[task.status]} flex-shrink-0`}>{statusLabel(task.status)}</span>
                  </div>
                  {task.description && <p className="text-xs text-text-muted truncate mt-0.5">{task.description}</p>}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {task.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />}
                  <span className="text-xs text-text-muted">{task.progress}%</span>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {task.status === 'running' && (
                    <button onClick={e => { e.stopPropagation(); handleAction(task.id, '/pause'); }} className="p-1 hover:bg-bg-hint rounded" title="Pause">
                      <Pause className="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  )}
                  {task.status === 'paused' && (
                    <button onClick={e => { e.stopPropagation(); handleAction(task.id, '/resume'); }} className="p-1 hover:bg-bg-hint rounded" title="Resume">
                      <Play className="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  )}
                  {(task.status === 'pending' || task.status === 'planning') && (
                    <button onClick={e => { e.stopPropagation(); handleAction(task.id, '/status'); }} className="p-1 hover:bg-bg-hint rounded" title="Start">
                      <Play className="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); handleDelete(task.id); }} className="p-1 hover:bg-red-500/10 rounded" title="Delete">
                    <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-red-400" />
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="ml-9 mr-4 h-1 bg-bg-dark rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${task.progress}%` }}
                />
              </div>

              {/* Steps */}
              {expanded[task.id] && (
                <div className="px-9 py-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">{task.currentStep}/{task.totalSteps} steps</span>
                    <button
                      onClick={() => handleAddStep(task.id)}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-accent hover:bg-accent/10 rounded transition"
                    >
                      <Plus className="w-3 h-3" /> Add step
                    </button>
                  </div>
                  {task.steps.length === 0 ? (
                    <p className="text-xs text-text-muted py-2 text-center">No steps yet. Steps are added as the task progresses.</p>
                  ) : (
                    task.steps.map(step => (
                      <div key={step.id} className="flex items-center gap-2 p-2 rounded-lg bg-bg-dark/50">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STEP_COLORS[step.status] || 'bg-gray-500'}`} />
                        <span className="flex-1 text-xs text-text-secondary truncate">{step.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                          step.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                          step.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                          step.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                          step.status === 'skipped' ? 'bg-orange-500/10 text-orange-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>
                          {step.status}
                        </span>
                        {step.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-blue-400 flex-shrink-0" />}
                        {step.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
                        {step.status === 'failed' && <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                      </div>
                    ))
                  )}
                </div>
              )}

              <div className="px-9 pb-2 flex items-center gap-3">
                <span className="flex items-center gap-1 text-[10px] text-text-muted">
                  <Clock className="w-2.5 h-2.5" />
                  {timeAgo(task.updatedAt)}
                </span>
                {task.completedAt && (
                  <span className="text-[10px] text-emerald-400/70">completed {timeAgo(task.completedAt)}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}