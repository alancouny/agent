import { useState, useEffect } from 'react';
import { apiUrl, getAgentApiKey } from '../apiConfig';
import { useTranslation } from 'react-i18next';
import { Plug, Plus, Activity, Loader2, Trash2, RefreshCw, Repeat } from 'lucide-react';

interface McpTool {
  name: string;
  description: string;
}

/** GET /api/mcp/:id/tools 的增强标注（R5）。 */
interface McpToolInfo {
  name: string;
  description: string;
  allowed: boolean;
  dangerous: boolean;
  forcedApproval: boolean;
}

interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  connected: boolean;
  tools: McpTool[];
  error?: string;
  autostart: boolean;
  reconnecting?: boolean;
  reconnectAttempts?: number;
  allowedTools?: string[];
}

const API = '/api/mcp';
const mcpUrl = (p: string) => apiUrl(API + p);

/** 裸 fetch 需要手动带 Bearer 头（后端 T01 起强制鉴权；axios 拦截器已自动处理）。 */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const key = getAgentApiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function getServers(): Promise<McpServer[]> {
  const res = await fetch(mcpUrl(''), { headers: authHeaders() });
  const data = await res.json();
  return data.servers || [];
}

export function McpPanel() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [newServer, setNewServer] = useState({
    name: '',
    transport: 'stdio' as McpServer['transport'],
    command: '',
    args: '',
    url: '',
  });
  // ── R5 白名单：服务器 id → 工具详情 / 勾选草稿 ──
  const [toolDetails, setToolDetails] = useState<Record<string, McpToolInfo[]>>({});
  const [draftAllowed, setDraftAllowed] = useState<Record<string, string[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [manageToolsFor, setManageToolsFor] = useState<string | null>(null);

  const loadTools = async (id: string) => {
    try {
      const res = await fetch(mcpUrl(`/${id}/tools`), { headers: authHeaders() });
      const data = await res.json();
      const tools: McpToolInfo[] = data.tools || [];
      setToolDetails(prev => ({ ...prev, [id]: tools }));
      // 仅首次初始化草稿（保留用户未保存的勾选）
      setDraftAllowed(prev => {
        if (prev[id]) return prev;
        return { ...prev, [id]: tools.filter(t => t.allowed).map(t => t.name) };
      });
    } catch { /* ignore */ }
  };

  const refresh = async () => {
    try {
      const list = await getServers();
      setServers(list);
      // 已连接服务器拉取工具详情（白名单标注）
      for (const s of list) {
        if (s.connected) void loadTools(s.id);
      }
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  };

  const toggleAllowed = (id: string, name: string) => {
    setDraftAllowed(prev => {
      const cur = prev[id] ?? [];
      const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name];
      return { ...prev, [id]: next };
    });
  };

  const saveWhitelist = async (id: string) => {
    const allowed = draftAllowed[id] ?? [];
    setSavingId(id);
    try {
      await fetch(mcpUrl(`/${id}`), {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ allowedTools: allowed }),
      });
    } finally {
      setSavingId(null);
      await refresh();
      await loadTools(id);
    }
  };

  // 初始加载 + 每 30 秒自动轮询（捕获重连状态变化）
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const id = setInterval(() => {
      if (!loading) void refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [loading]);

  const handleConnect = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(mcpUrl(`/${id}/connect`), { method: 'POST', headers: authHeaders() });
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  const handleDisconnect = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(mcpUrl(`/${id}/disconnect`), { method: 'POST', headers: authHeaders() });
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  const handleReconnect = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(mcpUrl(`/${id}/reconnect`), { method: 'POST', headers: authHeaders() });
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(mcpUrl(`/${id}`), { method: 'DELETE', headers: authHeaders() });
    await refresh();
  };

  const handleAdd = async () => {
    if (!newServer.name) return;
    await fetch(mcpUrl(''), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(newServer),
    });
    setShowAdd(false);
    setNewServer({ name: '', transport: 'stdio', command: '', args: '', url: '' });
    await refresh();
  };

  const runningCount = servers.filter(s => s.connected).length;

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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center">
            <Plug className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">{t('mcp.title')}</h2>
            <p className="text-sm text-text-secondary">
              {runningCount}/{servers.length} {t('mcp.connected')}
              {lastRefresh && (
                <span className="ml-2 text-text-muted">· {t('mcp.lastRefresh', { time: lastRefresh.toLocaleTimeString() })}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs text-text-secondary hover:bg-bg-hover transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('common.refresh')}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> {t('common.addServer')}
          </button>
        </div>
      </div>

      <div className="space-y-3 overflow-auto flex-1">
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Plug className="w-12 h-12 text-border-dark mb-4" />
            <p className="text-text-muted text-sm mb-2">{t('mcp.noServers')}</p>
            <p className="text-text-muted text-xs text-center max-w-xs">
              Add a stdio server (e.g. <code className="text-text-secondary">npx -y @modelcontextprotocol/server-memory</code>)
              or an SSE/HTTP endpoint. Connected tools become available to the agent automatically.
            </p>
          </div>
        ) : (
          servers.map(server => (
            <div key={server.id} className="bg-bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="font-bold text-text-primary flex items-center gap-2">
                      {server.name}
                      {server.connected && <Activity className="w-3.5 h-3.5 text-green-400" />}
                    </h3>
                    <p className="text-xs text-text-muted">{server.transport} &middot; {server.tools.length} tools</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs ${
                    server.connected ? 'bg-green-500/10 text-green-400'
                      : server.reconnecting ? 'bg-amber-500/10 text-amber-400'
                      : server.error ? 'bg-red-500/10 text-red-400'
                      : 'bg-bg-input text-text-muted'
                  }`}>
                    {server.connected ? t('mcp.status.connected')
                      : server.reconnecting ? `${t('mcp.status.reconnecting')} (${server.reconnectAttempts ?? 0})`
                      : server.error ? t('mcp.status.error')
                      : t('mcp.status.stopped')}
                  </span>
                </div>
              </div>

              {server.error && (
                <p className="mt-2 text-xs text-red-400 font-mono break-words">{server.error}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {server.tools.map(tool => (
                  <span key={tool.name} className="px-2 py-1 bg-bg-darker rounded text-xs text-text-secondary font-mono" title={tool.description}>
                    {tool.name.replace(`mcp__${server.name}__`, '')}
                  </span>
                ))}
                {server.tools.length === 0 && server.connected && (
                  <span className="text-xs text-text-muted">{t('mcp.noTools')}</span>
                )}
              </div>

              {/* ── R5 白名单：仅对已连接服务器展示工具勾选（fail-closed 默认全拦截）── */}
              {server.connected && (
                <div className="mt-3 border-t border-border pt-3">
                  <button
                    onClick={() => {
                      if (manageToolsFor === server.id) {
                        setManageToolsFor(null);
                      } else {
                        setManageToolsFor(server.id);
                        void loadTools(server.id);
                      }
                    }}
                    className="text-xs text-sky-400 hover:underline"
                  >
                    {manageToolsFor === server.id ? '收起工具白名单' : '配置工具白名单'}
                  </button>

                  {manageToolsFor === server.id && (
                    <div className="mt-2 space-y-1">
                      {(toolDetails[server.id] ?? []).map(tool => {
                        const checked = (draftAllowed[server.id] ?? []).includes(tool.name);
                        return (
                          <label key={tool.name} className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAllowed(server.id, tool.name)}
                              className="accent-primary"
                            />
                            <span className="font-mono text-text-primary">{tool.name.replace(`mcp__${server.name}__`, '')}</span>
                            {tool.dangerous && (
                              <span className="text-[10px] text-red-400 px-1.5 py-0.5 rounded bg-red-500/10">危险</span>
                            )}
                            {tool.forcedApproval && (
                              <span className="text-[10px] text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10">强制审批</span>
                            )}
                            {!tool.allowed && (
                              <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-input">拦截</span>
                            )}
                          </label>
                        );
                      })}
                      {(toolDetails[server.id] ?? []).length === 0 && (
                        <p className="text-xs text-text-muted">{t('mcp.noTools')}</p>
                      )}
                      <div className="flex items-center gap-3 pt-2">
                        <button
                          onClick={() => void saveWhitelist(server.id)}
                          disabled={savingId === server.id}
                          className="px-3 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary-hover transition disabled:opacity-50"
                        >
                          {savingId === server.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('common.save')}
                        </button>
                        <span className="text-[10px] text-text-muted">保存后需重连生效 · 未勾选工具对 LLM 不可见</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                {server.connected ? (
                  <button
                    onClick={() => handleDisconnect(server.id)}
                    disabled={busyId === server.id}
                    className="px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                  >
                    {busyId === server.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('common.disconnect')}
                  </button>
                ) : server.reconnecting ? (
                  <button disabled className="px-3 py-1.5 text-xs rounded bg-amber-500/10 text-amber-400 transition flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5 animate-spin" /> {t('mcp.status.reconnecting')} {server.reconnectAttempts ?? 0}
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(server.id)}
                    disabled={busyId === server.id}
                    className="px-3 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary-hover transition disabled:opacity-50"
                  >
                    {busyId === server.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('common.connect')}
                  </button>
                )}
                {!server.connected && !server.reconnecting && (
                  <button
                    onClick={() => handleReconnect(server.id)}
                    disabled={busyId === server.id}
                    className="px-3 py-1.5 text-xs rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-50"
                  >
                    <Repeat className="w-3.5 h-3.5" /> {t('mcp.reconnect')}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(server.id)}
                  className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition"
                  title={t('common.delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-dark border border-border rounded-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="text-lg font-bold text-text-primary">{t('mcp.addServer')}</h3>
            <input
              value={newServer.name}
              onChange={e => setNewServer({ ...newServer, name: e.target.value })}
              placeholder={t('mcp.serverNamePlaceholder')}
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
            />
            <div className="grid grid-cols-3 gap-2">
              {(['stdio', 'sse', 'http'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setNewServer({ ...newServer, transport: t })}
                  className={`px-3 py-2 rounded-lg text-sm border ${
                    newServer.transport === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {newServer.transport === 'stdio' ? (
              <>
                <input
                  value={newServer.command}
                  onChange={e => setNewServer({ ...newServer, command: e.target.value })}
                  placeholder={t('mcp.cmdPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
                />
                <input
                  value={newServer.args}
                  onChange={e => setNewServer({ ...newServer, args: e.target.value })}
                  placeholder={t('mcp.argsPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
                />
              </>
            ) : (
              <input
                value={newServer.url}
                onChange={e => setNewServer({ ...newServer, url: e.target.value })}
                placeholder={t('mcp.urlPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary"
              />
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-border text-text-secondary rounded-lg">{t('common.cancel')}</button>
              <button onClick={handleAdd} className="px-4 py-2 bg-primary text-white rounded-lg">{t('mcp.addAndConnectLater')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
