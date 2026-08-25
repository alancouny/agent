import { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl } from '../apiConfig';
import { useTranslation } from 'react-i18next';
import { Monitor, Play, Square, RefreshCw, Terminal, MousePointer, Keyboard, Eye, FolderOpen, Search, Globe, ExternalLink, ChevronRight, CheckCircle2, XCircle, AlertCircle, Loader2, Copy, Plug } from 'lucide-react';
import { apiFetch } from '../api/client';

interface CpuStatus {
  status: 'ready' | 'running' | 'mcp_missing' | 'error';
  message: string;
  serverScript: string | null;
  serverPid: number | null;
  tools: CpuTool[];
  error: string | null;
}

interface CpuTool {
  name: string;
  description: string;
  category: 'input' | 'output' | 'control' | 'monitor';
}

interface CpuLog {
  id: number;
  time: string;
  level: 'info' | 'error' | 'command' | 'output';
  text: string;
}

const API_BASE = '/api/computer-use';
const csUrl = (p: string) => apiUrl(API_BASE + p);

const CATEGORY_META = {
  input: { icon: Keyboard, label: 'Input', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  output: { icon: Eye, label: 'Output', color: 'text-green-400', bg: 'bg-green-500/10' },
  control: { icon: MousePointer, label: 'Control', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  monitor: { icon: FolderOpen, label: 'Monitor', color: 'text-amber-400', bg: 'bg-amber-500/10' },
};

const TOOL_ICONS: Record<string, { icon: React.ElementType; label: string }> = {
  screenshot: { icon: Eye, label: 'Screenshot' },
  mouse_move: { icon: MousePointer, label: 'Mouse Move' },
  mouse_click: { icon: MousePointer, label: 'Mouse Click' },
  type_text: { icon: Keyboard, label: 'Type Text' },
  press_key: { icon: Keyboard, label: 'Press Key' },
  scroll: { icon: RefreshCw, label: 'Scroll' },
  clipboard_get: { icon: Copy, label: 'Clipboard Get' },
  clipboard_set: { icon: Copy, label: 'Clipboard Set' },
  list_apps: { icon: FolderOpen, label: 'List Apps' },
  list_windows: { icon: Monitor, label: 'List Windows' },
  find_text: { icon: Search, label: 'Find Text' },
  open_url: { icon: Globe, label: 'Open URL' },
  open_app: { icon: ExternalLink, label: 'Open App' },
};

export function ComputerPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CpuStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [logs, setLogs] = useState<CpuLog[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'input' | 'output' | 'control' | 'monitor'>('all');
  const [copyResult, setCopyResult] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch(csUrl('/status'));
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({
        status: 'error',
        message: t('computer.errConnect'),
        serverScript: null,
        serverPid: null,
        tools: [],
        error: t('computer.unreachable'),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  const addLog = (level: CpuLog['level'], text: string) => {
    setLogs(prev => [...prev, {
      id: prev.length,
      time: new Date().toLocaleTimeString(),
      level,
      text,
    }]);
  };

  const handleStart = async () => {
    setActionLoading(true);
    addLog('command', 'agent computer-use start');
    try {
      const res = await apiFetch(csUrl('/start'), { method: 'POST' });
      const data = await res.json();
      addLog(data.success ? 'output' : 'error', data.message);
      await fetchStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', `Start failed: ${message}`);
    }
    setActionLoading(false);
  };

  const handleStop = async () => {
    setActionLoading(true);
    addLog('command', 'agent computer-use stop');
    try {
      const res = await apiFetch(csUrl('/stop'), { method: 'POST' });
      const data = await res.json();
      addLog(data.success ? 'output' : 'error', data.message);
      await fetchStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', `Stop failed: ${message}`);
    }
    setActionLoading(false);
  };

  const handleTestTool = async (toolName: string) => {
    setActionLoading(true);
    addLog('command', `${toolName}(${JSON.stringify({ text: 'hello', url: 'https://example.com', name: 'Finder', key: 'enter' })})`);
    try {
      const res = await apiFetch(apiUrl('/api/agent/tools/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: `computer_use.${toolName}`,
          args: {
            text: 'hello from agent',
            url: 'https://example.com',
            name: 'Finder',
            key: 'enter',
            x: 100,
            y: 100,
          },
        }),
      });
      const data = await res.json();
      addLog(data.success ? 'output' : 'error', data.output || data.error || 'no response');
      setCopyResult(data.output || '');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', `Tool call failed: ${message}`);
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{t('computer.checking')}</span>
        </div>
      </div>
    );
  }

  if (!status) {
    return <div className="p-6 text-text-muted">{t('computer.errLoad')}</div>;
  }

  const isRunning = status.status === 'running';

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Monitor className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">{t('computer.title')}</h2>
            <p className="text-sm text-text-secondary">{t('computer.serverDesc')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatus}
            className="p-2 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-primary/40 transition-colors"
            title="Refresh status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {!isRunning && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('computer.start')}
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleStop}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5" />
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('computer.stop')}
            </button>
          )}
        </div>
      </div>

      {/* Status Card */}
      <div className={`rounded-xl border p-4 flex items-center gap-4 ${
        isRunning
          ? 'bg-green-500/5 border-green-500/30'
          : status.status === 'error'
            ? 'bg-red-500/5 border-red-500/30'
            : 'bg-bg-card border-border'
      }`}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0">
          {isRunning ? (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          ) : status.status === 'error' ? (
            <XCircle className="w-5 h-5 text-red-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold text-sm ${
              isRunning ? 'text-green-400' : status.status === 'error' ? 'text-red-400' : 'text-amber-400'
            }`}>
              {isRunning ? 'RUNNING' : status.status === 'error' ? 'ERROR' : 'READY'}
            </span>
            {status.serverPid && (
              <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-xs font-mono">
                PID {status.serverPid}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary mt-0.5">{status.message}</p>
          {status.error && (
            <p className="text-xs text-red-400 mt-1 font-mono">{status.error}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted mb-1">{t('common.tools') || t('tools.title')}</div>
          <div className="text-2xl font-bold text-text-primary">{status.tools.length}</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {/* Tools List */}
        <div className="col-span-2 bg-bg-card border border-border rounded-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm text-text-primary">MCP {t('tools.title')}</span>
            <div className="flex items-center gap-1">
              {(['all', 'input', 'output', 'control', 'monitor'] as const).map(cat => {
                const meta = cat === 'all' ? { label: 'computer.categoryAll' } : CATEGORY_META[cat];
                const count = cat === 'all' ? status.tools.length : status.tools.filter(t => t.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      selectedCategory === cat
                        ? 'bg-primary/20 text-primary'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {t(meta.label)} {count > 0 ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {(selectedCategory === 'all' ? status.tools : status.tools.filter(t => t.category === selectedCategory)).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted py-8">
                <Terminal className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">{t('computer.noToolsInCategory')}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {status.tools
                  .filter(t => selectedCategory === 'all' || t.category === selectedCategory)
                  .map(tool => {
                    const meta = CATEGORY_META[tool.category];
                    const toolMeta = TOOL_ICONS[tool.name] || { icon: Monitor, label: tool.name };
                    return (
                      <button
                        key={tool.name}
                        onClick={() => handleTestTool(tool.name)}
                        disabled={actionLoading}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-darker transition-colors text-left group disabled:opacity-50"
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bg}`}>
                          <toolMeta.icon className={`w-3.5 h-3.5 ${meta.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium text-text-primary">
                              {tool.name}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${meta.bg} ${meta.color}`}>
                              {t(meta.label)}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary truncate mt-0.5">
                            {tool.description}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* Activity Log */}
        <div className="bg-bg-darker border border-border rounded-xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Terminal className="w-4 h-4 text-text-muted" />
            <span className="font-semibold text-sm text-text-primary">{t('computer.console')}</span>
            {copyResult && (
              <button
                onClick={() => { navigator.clipboard.writeText(copyResult); setCopyResult(''); }}
                className="ml-auto px-2 py-0.5 rounded text-xs bg-primary/20 text-primary hover:bg-primary/30"
              >
                {t('computer.copyOutput')}
              </button>
            )}
          </div>
          <div ref={logRef} className="flex-1 overflow-auto p-3 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted py-8 text-center">
                <Terminal className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">{t('computer.noActivity')}</p>
                <p className="text-xs mt-1 opacity-70">Start the MCP server and test tools to see output</p>
              </div>
            ) : (
              logs.map(line => (
                <div key={line.id} className="flex items-start gap-2">
                  <span className="text-text-muted flex-shrink-0">[{line.time}]</span>
                  <span className={`break-all ${
                    line.level === 'error' ? 'text-red-400'
                      : line.level === 'command' ? 'text-blue-400'
                      : line.level === 'output' ? 'text-green-400'
                      : 'text-text-primary'
                  }`}>
                    {line.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* MCP Protocol Info */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-darker border border-border rounded-xl">
        <div className="flex items-center gap-3">
          <Plug className="w-4 h-4 text-text-muted" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{t('computer.protocol')}:</span>
            <span className="text-xs font-mono text-text-primary">MCP stdio</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{t('computer.transport')}:</span>
            <span className="text-xs font-mono text-text-primary">node + tsx</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{t('computer.server')}:</span>
            <span className="text-xs font-mono text-text-primary truncate max-w-[200px]">
              {status.serverScript ? status.serverScript.split('/').pop() : 'not found'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400' : 'bg-amber-400'}`} />
          <span className="text-xs text-text-muted">{isRunning ? t('computer.connected') : t('computer.disconnected')}</span>
        </div>
      </div>
    </div>
  );
}