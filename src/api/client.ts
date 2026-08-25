import axios from 'axios';
import { getApiBase, apiUrl, getAgentApiKey } from '../apiConfig';
import { logger } from '../utils/logger';
import type {
  Message, Model, ImageGenerationRequest, ImageGenerationResponse,
  VideoGenerationRequest, VideoGenerationResponse, CodeAnalysisRequest,
  CodeAnalysisResponse, ModelProvider, ModelInfo, ProviderConfig,
  CustomProviderCreateRequest, ConnectionTestResult, AgentStreamEvent,
  AgentTool, Session, AuditLog, SearchResult, CompareResult, TrajectoryEvent, DbMessage,
} from '../types';

/** 解析 axios baseURL：getApiBase() 返回不含 /api 的根地址（后端路由统一挂在 /api 下）。 */
function resolveBaseUrl(): string {
  const base = getApiBase();
  return base ? `${base.replace(/\/+$/, '')}/api` : '/api';
}

/** 从 Settings 的通用设置读取超时（秒），供 axios 与 SSE 兜底使用。 */
function readRequestTimeoutMs(): number {
  try {
    const raw = localStorage.getItem('gen_settings');
    if (raw) {
      const parsed = JSON.parse(raw) as { timeout?: number };
      const t = Number(parsed.timeout);
      if (Number.isFinite(t) && t >= 10 && t <= 300) return t * 1000;
    }
  } catch { /* fall through to default */ }
  return 60000;
}

const api = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: readRequestTimeoutMs(),
});

/** 401 可读提示：后端启动日志会打印生成的 AGENT_API_KEY（决策 A / S4 默认方案）。 */
export const AUTH_401_HINT =
  '鉴权失败：请在启动日志中获取 AGENT_API_KEY 并配置 VITE_AGENT_API_KEY（或在 Settings 填入 API Key）';

/** Attach Bearer token from env (VITE_AGENT_API_KEY) or localStorage. */
api.interceptors.request.use((config) => {
  const key = getAgentApiKey();
  if (key) config.headers.Authorization = `Bearer ${key}`;
  return config;
});

/**
 * R3：读取响应头 X-Request-Id。
 * - 成功：logger.info 记录 requestId（P1 最小实现）；
 * - 失败：把 requestId 附加到 error.message，便于前端报错与后端日志关联；
 * - 401：给出可读鉴权提示（避免静默失败）。
 */
api.interceptors.response.use(
  (response) => {
    const rid = response.headers?.['x-request-id'];
    if (rid) {
      const method = (response.config?.method ?? 'get').toUpperCase();
      logger.info(`[api] ${method} ${response.config?.url ?? ''} ${response.status} (requestId: ${rid})`);
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) logger.warn(AUTH_401_HINT);
    const rid = error.response?.headers?.['x-request-id'];
    if (rid && typeof error.message === 'string' && !error.message.includes(rid)) {
      error.message = `${error.message} (requestId: ${rid})`;
    }
    return Promise.reject(error);
  }
);

/**
 * 统一裸 fetch 封装：自动带 Bearer（VITE_AGENT_API_KEY 或 localStorage），401 给出可读提示。
 * 各面板不得再直接 window.fetch；SSE 走 streamAgentEvents（其内部自行带 Bearer）。
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const key = getAgentApiKey();
  if (key) headers.set('Authorization', `Bearer ${key}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) logger.warn(AUTH_401_HINT);
  return res;
}

/** API 地址或超时设置切换后调用：更新 axios 实例。 */
export function applyApiBase() {
  api.defaults.baseURL = resolveBaseUrl();
  api.defaults.timeout = readRequestTimeoutMs();
}

export const healthApi = {
  check: async () => {
    const response = await api.get('/health');
    return response.data;
  },
};

export const ollamaApi = {
  getModels: async (): Promise<{ models: Model[]; available: boolean }> => {
    try {
      const response = await api.get('/ollama/models');
      return response.data;
    } catch {
      return { models: [], available: false };
    }
  },

  chat: async (
    model: string,
    messages: Message[],
    stream: boolean = true
  ) => {
    const response = await api.post('/ollama/chat', {
      model,
      messages,
      stream,
    });
    return response;
  },

  generate: async (
    model: string,
    prompt: string,
    stream: boolean = true
  ) => {
    const response = await api.post('/ollama/generate', {
      model,
      prompt,
      stream,
    });
    return response;
  },

  pullModel: async (model: string) => {
    const response = await api.post('/ollama/pull', { model });
    return response;
  },
};

export const imageApi = {
  generate: async (
    request: ImageGenerationRequest
  ): Promise<ImageGenerationResponse> => {
    const response = await api.post('/image/generate', request);
    return response.data;
  },

  variations: async (
    image_url: string,
    prompt: string,
    variations: number = 4
  ) => {
    const response = await api.post('/image/variations', {
      image_url,
      prompt,
      variations,
    });
    return response.data;
  },
};

export const videoApi = {
  generate: async (
    request: VideoGenerationRequest
  ): Promise<VideoGenerationResponse> => {
    const response = await api.post('/video/generate', request);
    return response.data;
  },

  getStatus: async (id: string) => {
    const response = await api.get(`/video/status/${id}`);
    return response.data;
  },
};

export const codeApi = {
  analyze: async (
    request: CodeAnalysisRequest
  ): Promise<CodeAnalysisResponse> => {
    const response = await api.post('/code/analyze', request);
    return response.data;
  },

  generate: async (
    prompt: string,
    language?: string,
    framework?: string
  ) => {
    const response = await api.post('/code/generate', {
      prompt,
      language,
      framework,
    });
    return response.data;
  },

  refactor: async (
    code: string,
    language?: string,
    improvements?: string
  ) => {
    const response = await api.post('/code/refactor', {
      code,
      language,
      improvements,
    });
    return response.data;
  },
};

export const modelProviderApi = {
  getProviders: async (): Promise<{ providers: ModelProvider[]; currentProvider: string }> => {
    const response = await api.get('/model/providers');
    return response.data;
  },

  getProvider: async (id: string): Promise<{ provider: ModelProvider; config: ProviderConfig }> => {
    const response = await api.get(`/model/providers/${id}`);
    return response.data;
  },

  getProviderModels: async (id: string): Promise<{ provider: string; models: ModelInfo[] }> => {
    const response = await api.get(`/model/providers/${id}/models`);
    return response.data;
  },

  configureProvider: async (id: string, config: ProviderConfig): Promise<{ message: string; provider: string; config: ProviderConfig }> => {
    const response = await api.post(`/model/providers/${id}/config`, config);
    return response.data;
  },

  setCurrentProvider: async (providerId: string): Promise<{ message: string; currentProvider: string; providerInfo: ModelProvider }> => {
    const response = await api.post('/model/current', { providerId });
    return response.data;
  },

  getCurrentProvider: async (): Promise<{ currentProvider: string; providerInfo: ModelProvider; config: ProviderConfig }> => {
    const response = await api.get('/model/current');
    return response.data;
  },

  getCapabilities: async (): Promise<{ capabilities: string[]; providersByCapability: Record<string, string[]> }> => {
    const response = await api.get('/model/capabilities');
    return response.data;
  },

  createCustomProvider: async (request: CustomProviderCreateRequest): Promise<{ message: string; provider: ModelProvider }> => {
    const response = await api.post('/model/custom', request);
    return response.data;
  },

  updateCustomProvider: async (id: string, request: Partial<CustomProviderCreateRequest>): Promise<{ message: string; provider: ModelProvider }> => {
    const response = await api.put(`/model/custom/${id}`, request);
    return response.data;
  },

  deleteCustomProvider: async (id: string): Promise<{ message: string; provider: ModelProvider }> => {
    const response = await api.delete(`/model/custom/${id}`);
    return response.data;
  },

  discoverModels: async (id: string): Promise<{ message: string; models: ModelInfo[]; error?: string }> => {
    const response = await api.post(`/model/custom/${id}/discover-models`);
    return response.data;
  },

  testConnection: async (id: string): Promise<ConnectionTestResult> => {
    const response = await api.post(`/model/custom/${id}/test`);
    return response.data;
  },
};

/** Shared SSE reader used by /chat and /workflow/run (identical event schema). */
function streamAgentEvents(
  url: string,
  body: Record<string, unknown>,
  fallbackSessionId: string | undefined,
  onEvent?: (event: AgentStreamEvent) => void,
  signal?: AbortSignal
): Promise<{ response: string; sessionId: string }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const combinedSignal = signal || controller.signal;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // SSE 走原生 fetch，需手动带上与 axios 拦截器一致的 Bearer 头（后端 T01 起强制鉴权）
    const apiKey = getAgentApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // 空闲超时兜底：读超时（默认 60s，可被 Settings 覆盖）内无任何数据视为断流，
    // 主动 abort 让下方 catch 以 AbortError reject——配合后端 :ping 心跳不会误触发。
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new Error('SSE idle timeout')), readRequestTimeoutMs());
    };

    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combinedSignal,
    }).then(async (response) => {
      // R3：SSE 路径同样附带 requestId（错误提示可定位后端日志）
      const rid = response.headers.get('x-request-id');
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`${err || 'Stream failed'}${rid ? ` (requestId: ${rid})` : ''}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let fullContent = '';
      let resultSessionId = fallbackSessionId || '';
      let buffer = ''; // 保留跨 chunk 的未完成行，避免大事件被截断

      const processDataLine = (data: string) => {
        try {
          const event: AgentStreamEvent = JSON.parse(data);
          if (event.sessionId) resultSessionId = event.sessionId;
          if (event.type === 'text' && event.content) fullContent += event.content;
          onEvent?.(event);
        } catch (parseErr) {
          logger.warn('[SSE] Failed to parse event line', data.slice(0, 80), parseErr);
        }
      };

      resetIdle();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line.startsWith('data: ')) processDataLine(line.slice(6));
          // ': ping' 为服务端心跳注释行，无需处理（已重置 idle 计时）
        }
      }
      if (buffer.trim().startsWith('data: ')) processDataLine(buffer.trim().slice(6));
      if (idleTimer) clearTimeout(idleTimer);
      resolve({ response: fullContent, sessionId: resultSessionId });
    }).catch((err) => {
      if (idleTimer) clearTimeout(idleTimer);
      // AbortError 也 reject：用户 Stop / 空闲超时都让调用方的 .catch 收尾（其已判 AbortError 静默），
      // 修复原实现 return 导致 Promise 永不 settle 的泄漏。
      reject(err);
    });
  });
}

/** LangGraph-style supervisor workflow (StateGraph) over HTTP. */
export const workflowApi = {
  run: (
    message: string,
    sessionId?: string,
    model?: string,
    provider?: string,
    baseUrl?: string,
    apiKey?: string,
    systemPrompt?: string,
    onEvent?: (event: AgentStreamEvent) => void,
    signal?: AbortSignal,
    thinkingMode?: boolean
  ): Promise<{ response: string; sessionId: string }> => {
    return streamAgentEvents(
      apiUrl('/api/workflow/run'),
      { message, sessionId, model, provider, baseUrl, apiKey, systemPrompt, thinkingMode: !!thinkingMode },
      sessionId,
      onEvent,
      signal
    );
  },
  graph: async () => {
    const response = await api.get('/workflow/graph');
    return response.data;
  },
};

export const agentApi = {
  chat: (
    message: string,
    sessionId?: string,
    model?: string,
    provider?: string,
    baseUrl?: string,
    apiKey?: string,
    systemPrompt?: string,
    onEvent?: (event: AgentStreamEvent) => void,
    signal?: AbortSignal,
    autoRun?: boolean,
    thinkingMode?: boolean
  ): Promise<{ response: string; sessionId: string }> => {
    return streamAgentEvents(
      apiUrl('/api/agent/chat'),
      {
        message,
        sessionId,
        model,
        provider,
        baseUrl,
        apiKey,
        systemPrompt,
        stream: true,
        autoRun: !!autoRun,
        thinkingMode: !!thinkingMode,
        // 全局长期记忆注入开关（MemoryPanel 持久化到 localStorage）
        memoryInject: (() => {
          try { return localStorage.getItem('memory_inject_enabled') === '1'; } catch { return false; }
        })(),
        // 元认知：计算预算预测（校准研究）
        metacognition: (() => {
          try { return localStorage.getItem('metacog_enabled') === '1'; } catch { return false; }
        })(),
      },
      sessionId,
      onEvent,
      signal
    );
  },

  getTools: async (): Promise<AgentTool[]> => {
    const response = await api.get('/agent/tools');
    return response.data.tools;
  },

  executeTool: async (toolName: string, args: Record<string, unknown>, sessionId?: string) => {
    const response = await api.post('/agent/tools/execute', { toolName, args, sessionId });
    return response.data;
  },

  search: async (q: string, sessionId?: string): Promise<{ results: SearchResult[] }> => {
    const response = await api.get('/agent/search', { params: { q, sessionId } });
    return response.data;
  },

  fork: async (sessionId: string): Promise<{ newSessionId: string }> => {
    const response = await api.post('/agent/fork', { sessionId });
    return response.data;
  },

  tokens: async (sessionId: string): Promise<{ tokens: { total: number; prompt: number; completion: number } }> => {
    const response = await api.get('/agent/tokens', { params: { sessionId } });
    return response.data;
  },

  compare: async (message: string, targets: { provider: string; model: string; baseUrl?: string; apiKey?: string }[]): Promise<{ results: CompareResult[] }> => {
    const response = await api.post('/agent/compare', { message, targets });
    return response.data;
  },

  /** Harness-style trajectory: the full session event log (what the model saw), grouped by turn/step. */
  trajectory: async (sessionId: string): Promise<{
    sessionId: string;
    events: TrajectoryEvent[];
    turns: { turnIdx: number; steps: { stepIdx: number; events: TrajectoryEvent[] }[] }[];
  }> => {
    const response = await api.get('/agent/trajectory', { params: { sessionId } });
    return response.data;
  },

  /** Steering: queue a user message that the running agent injects before its next step. */
  steer: async (sessionId: string, message: string): Promise<{ ok: boolean }> => {
    const response = await api.post('/agent/steer', { sessionId, message });
    return response.data;
  },

  /** R4：读取审批全局开关状态。 */
  getApprovalRequired: async (): Promise<{ approvalRequired: boolean }> => {
    const response = await api.get('/agent/settings/approval');
    return response.data;
  },

  /** R4：设置审批全局开关；关闭（enabled=false）必须带 confirm:true（后端二次确认）。 */
  setApprovalRequired: async (enabled: boolean, confirm?: boolean): Promise<{ approvalRequired: boolean }> => {
    const response = await api.post('/agent/settings/approval', { enabled, confirm: !!confirm });
    return response.data;
  },
};

export const knowledgeApi = {
  ingest: async (payload: { title?: string; text?: string; url?: string }) => {
    const response = await api.post('/knowledge/ingest', payload);
    return response.data;
  },
  search: async (query: string, topK?: number) => {
    const response = await api.post('/knowledge/search', { query, topK });
    return response.data;
  },
  docs: async () => {
    const response = await api.get('/knowledge/docs');
    return response.data;
  },
  deleteDoc: async (id: string) => {
    const response = await api.delete(`/knowledge/docs/${id}`);
    return response.data;
  },
  getConfig: async () => {
    const response = await api.get('/knowledge/config');
    return response.data.config;
  },
  updateConfig: async (patch: Record<string, unknown>) => {
    const response = await api.put('/knowledge/config', patch);
    return response.data.config;
  },
  rebuild: async () => {
    const response = await api.post('/knowledge/rebuild');
    return response.data;
  },
  indexStatus: async () => {
    const response = await api.get('/knowledge/index');
    return response.data;
  },
  indexSync: async () => {
    const response = await api.post('/knowledge/index/sync');
    return response.data;
  },
};

export const promptsApi = {
  list: async () => {
    const response = await api.get('/prompts');
    return response.data;
  },
  add: async (name: string, content: string) => {
    const response = await api.post('/prompts', { name, content });
    return response.data;
  },
  update: async (id: string, name: string, content: string) => {
    const response = await api.put(`/prompts/${id}`, { name, content });
    return response.data;
  },
  remove: async (id: string) => {
    const response = await api.delete(`/prompts/${id}`);
    return response.data;
  },
};

export interface TtsVoice { id: string; name: string; category: string; }

/** Voice: text→speech (TTS) and speech→text (STT) via the OpenAI-compatible endpoints. */
export const voiceApi = {
  tts: async (text: string, voice = 'alloy'): Promise<{ audioBase64: string; format: string }> => {
    const response = await api.post('/voice/tts', { text, voice });
    return response.data;
  },
  stt: async (audioBase64: string): Promise<{ text: string }> => {
    const response = await api.post('/voice/stt', { audioBase64 });
    return response.data;
  },
  getVoices: async (): Promise<{ voices: TtsVoice[]; source: string }> => {
    const response = await api.get('/voice/voices');
    return response.data;
  },
};

export const sessionApi = {  list: async (): Promise<Session[]> => {
    const response = await api.get('/sessions');
    return response.data.sessions;
  },

  create: async (model: string, provider: string, title?: string): Promise<Session> => {
    const response = await api.post('/sessions', { model, provider, title });
    return response.data.session;
  },

  getMessages: async (sessionId: string): Promise<DbMessage[]> => {
    const response = await api.get(`/sessions/${sessionId}/messages`);
    return response.data.messages;
  },

  delete: async (sessionId: string): Promise<void> => {
    await api.delete(`/sessions/${sessionId}`);
  },

  getAuditLogs: async (sessionId: string): Promise<AuditLog[]> => {
    const response = await api.get(`/sessions/${sessionId}/audit`);
    return response.data.logs;
  },

  getMemories: async (sessionId: string): Promise<unknown[]> => {
    const response = await api.get(`/sessions/${sessionId}/memories`);
    return response.data.memories;
  },
};

// ── 极客功能模块 API ───────────────────────────────────────────

export interface SystemStats {
  cpu: { usage: number | null; cores: number; model: string; loadAvg: number[] };
  memory: { total: number; free: number; used: number; percent: number };
  net: { rxRate: number; txRate: number; rxTotal: number; txTotal: number } | null;
  uptime: number;
  hostname: string;
  platform: string;
  timestamp: number;
}

export const systemApi = {
  stats: async (): Promise<SystemStats> => {
    const response = await api.get('/system/stats');
    return response.data;
  },
};

export interface GitChange { status: string; staged: boolean; path: string; oldPath?: string; }
export interface GitStatus {
  cwd: string;
  branch: string | null;
  changes: GitChange[];
  summary: Record<string, number>;
  total: number;
  timestamp: string;
}
export interface GitCommit { short: string; hash: string; subject: string; author: string; date: string; }
export interface GitBranch { name: string; current: boolean; upstream?: string; }

export const gitApi = {
  status: async (cwd?: string): Promise<GitStatus> => {
    const response = await api.get('/git/status', { params: { cwd } });
    return response.data;
  },
  branches: async (cwd?: string): Promise<{ branches: GitBranch[] }> => {
    const response = await api.get('/git/branches', { params: { cwd } });
    return response.data;
  },
  log: async (cwd?: string, n = 20): Promise<{ commits: GitCommit[] }> => {
    const response = await api.get('/git/log', { params: { cwd, n } });
    return response.data;
  },
  diff: async (cwd?: string, path?: string): Promise<{ stat: string; diff: string }> => {
    const response = await api.get('/git/diff', { params: { cwd, path } });
    return response.data;
  },
  commit: async (cwd: string | undefined, message: string, addAll = true) => {
    const response = await api.post('/git/commit', { cwd, message, addAll });
    return response.data;
  },
  createBranch: async (cwd: string | undefined, name: string) => {
    const response = await api.post('/git/branch', { cwd, name });
    return response.data;
  },
  checkout: async (cwd: string | undefined, branch: string) => {
    const response = await api.post('/git/checkout', { cwd, branch });
    return response.data;
  },
};

export interface TextSearchResult { file: string; line: number; text: string; }
export interface ReplacePreview { file: string; count: number; before: string; after: string; }

export const textToolsApi = {
  search: async (pattern: string, cwd?: string, caseSensitive = false, files?: string[]) => {
    const response = await api.post('/texttools/search', { pattern, cwd, caseSensitive, files });
    return response.data as { results: TextSearchResult[]; count: number; truncated: boolean; root: string };
  },
  replace: async (pattern: string, replacement: string, files: string[], cwd?: string, dryRun = true) => {
    const response = await api.post('/texttools/replace', { pattern, replacement, files, cwd, dryRun });
    return response.data as {
      dryRun: boolean; total: number; previews: ReplacePreview[]; applied: string[]; count: number;
    };
  },
  rename: async (cwd: string | undefined, files: { path: string; newName: string }[]) => {
    const response = await api.post('/texttools/rename', { cwd, files });
    return response.data;
  },
};

export interface PluginInfo {
  name: string;
  description: string;
  version?: string;
  commands: string[];
  hooks: string[];
}

export const pluginsApi = {
  list: async (): Promise<{ plugins: PluginInfo[]; count: number; dir: string }> => {
    const response = await api.get('/plugins');
    return response.data;
  },
  reload: async () => {
    const response = await api.post('/plugins/reload');
    return response.data;
  },
  run: async (plugin: string, command: string, args: string[], cwd?: string) => {
    const response = await api.post('/plugins/run', { plugin, command, args, cwd });
    return response.data as { ok: boolean; output: string; error?: string };
  },
};

export interface ExperimentRunResult {
  label: string;
  model: string;
  ok: boolean;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls: number;
  output: string;
  error: string | null;
  fingerprint: { toolUsage: Record<string, number>; toolDiversity: number };
}

export interface ExperimentResponse {
  prompt: string;
  wallMs: number;
  runs: ExperimentRunResult[];
  winners: { quickest: string | null; cheapest: string | null; fewestCalls: string | null };
}

export const experimentsApi = {
  run: async (
    prompt: string,
    runs: { label: string; model: string; temperature?: number; systemPrompt?: string; apiKey?: string; baseUrl?: string }[],
    maxIterations = 15,
    signal?: AbortSignal
  ): Promise<ExperimentResponse> => {
    const response = await api.post('/experiments/run', { prompt, runs, maxIterations }, { signal });
    return response.data;
  },
};

// ── LLM 追踪（瀑布图）──
export interface LLMCallRecord {
  id: string;
  sessionId: string;
  agentKind: 'main' | 'delegate' | 'supervisor' | 'worker';
  parentId: string | null;
  model: string;
  startAt: number;
  endAt: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turn: number;
  step: number;
  toolNames: string[];
  failed: boolean;
  contentPreview: string;
}

export const telemetryApi = {
  llmCalls: async (sessionId?: string, limit = 200): Promise<{ calls: LLMCallRecord[]; count: number }> => {
    const response = await api.get('/telemetry/llm-calls', { params: { sessionId, limit } });
    return response.data;
  },
};

// ── 全局长期记忆 ──
export interface MemoryProviderInfo {
  id: string;
  kind: 'local' | 'mcp';
  label: string;
  available: boolean;
  active: boolean;
}
export interface MemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  source: string;
  providerId?: string;
  createdAt: string;
  updatedAt: string;
  score?: number;
}

export const memoryApi = {
  providers: async (): Promise<{ providers: MemoryProviderInfo[] }> => {
    const response = await api.get('/memory/providers');
    return response.data;
  },
  activate: async (id: string, active: boolean) => {
    const response = await api.post(`/memory/providers/${id}/activate`, { active });
    return response.data;
  },
  search: async (q: string, topK = 5): Promise<{ results: MemoryEntry[]; count: number; sources: string[] }> => {
    const response = await api.get('/memory/search', { params: { q, topK } });
    return response.data;
  },
  list: async (provider?: string): Promise<{ entries: MemoryEntry[]; sources: string[] }> => {
    const response = await api.get('/memory', { params: { provider } });
    return response.data;
  },
  add: async (content: string, tags?: string[]) => {
    const response = await api.post('/memory', { content, tags });
    return response.data;
  },
  update: async (id: string, patch: { content?: string; tags?: string[] }) => {
    const response = await api.patch(`/memory/${id}`, patch);
    return response.data;
  },
  remove: async (id: string) => {
    const response = await api.delete(`/memory/${id}`);
    return response.data;
  },
};


// ── 漂移雷达 ──
export interface DriftPoint { text: string; score: number; isEvent: boolean; ts: number; }
export const driftApi = {
  state: async (sessionId?: string): Promise<{ history: DriftPoint[]; events: number; count: number; driftRate: number }> => {
    const response = await api.get('/drift', { params: sessionId ? { sessionId } : {} });
    return response.data;
  },
};

// ── 元认知（预算预测校准）──
export interface CostEstimate {
  id: string;
  sessionId: string;
  model: string;
  predictedToolCalls: number | null;
  predictedTokens: number | null;
  actualToolCalls: number;
  actualTokens: number;
  createdAt: string;
}
export interface CalibrationBin { bin: string; predicted: number; actual: number; n: number; }
export const metacogApi = {
  estimates: async (sessionId?: string): Promise<{ estimates: CostEstimate[]; count: number; calibration: CalibrationBin[] }> => {
    const response = await api.get('/metacog/estimates', { params: sessionId ? { sessionId } : {} });
    return response.data;
  },
};

export const memoryLessonsApi = {
  list: async (): Promise<{ lessons: MemoryEntry[]; count: number }> => {
    const response = await api.get('/memory/lessons');
    return response.data;
  },
};
