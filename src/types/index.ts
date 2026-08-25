export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  isStreaming?: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    /** 模型上下文窗口容量（tokens），后端随 usage 事件下发 */
    contextWindow?: number;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'approval_pending' | 'error' | 'complete' | 'thinking' | 'done' | 'file_modified' | 'context_compressed';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: { name: string; result: string };
  approval?: { toolName: string; args: Record<string, unknown>; approvalKey: string; output: string };
  error?: string;
  sessionId?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    /** 模型上下文窗口容量（tokens），后端随 usage 事件下发 */
    contextWindow?: number;
  };
  /** 自适应上下文压缩触发时的压缩统计 */
  contextCompressed?: {
    beforeTokens?: number;
    afterTokens?: number;
    savings?: number;
    layers?: Record<string, number>;
    usageRatio?: number;
  };
  /** file_modified 事件：AI 写入的文件路径与内容摘要 */
  fileModified?: {
    path: string;
    operation: 'write' | 'create' | 'delete';
    lineCount?: number;
    snippet?: string;
  };
}

export interface AgentTool {
  name: string;
  description: string;
  category: string;
  requiresApproval: boolean;
  enabled: boolean;
  schema: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface Session {
  id: string;
  title: string;
  model: string;
  provider: string;
  created_at: string;
  updated_at: string;
  summary?: string;
}

export interface AuditLog {
  id: string;
  session_id: string;
  event_type: string;
  tool_name: string;
  input: string;
  output: string;
  permission: string;
  duration_ms: number;
  created_at: string;
}

export interface Model {
  name: string;
  model: string;
  modified_at: string;
  size: string;
  digest: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  width?: number;
  height?: number;
  style?: string;
  negative_prompt?: string;
}

export interface ImageGenerationResponse {
  image_url: string;
  prompt: string;
  style: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  negative_prompt?: string;
  duration?: number;
  style?: string;
}

export interface VideoGenerationResponse {
  video_url: string;
  thumbnail: string;
  prompt: string;
  duration: number;
  style: string;
  status: string;
}

export interface CodeAnalysisRequest {
  code: string;
  language?: string;
}

export interface CodeAnalysisResponse {
  analysis: string;
  code: string;
  language: string;
}

export type TabType =
  | 'chat'
  | 'tasks'
  | 'computer'
  | 'terminal'
  | 'workspace'
  | 'skills'
  | 'image'
  | 'video'
  | 'mcp'
  | 'models'
  | 'tools'
  | 'voice'
  | 'settings'
  // ── 极客功能模块 ──
  | 'monitor'    // 实时系统监控仪表盘
  | 'git'        // 自动化 Git 工作流
  | 'texttools'  // 文本处理工具（正则/替换/重命名）
  | 'plugins'    // 可扩展插件系统
  | 'markdown'   // Markdown 实时预览与导出
  | 'experiments' // A/B 实验台（prompt × 模型/参数对比）
  | 'trace'       // LLM 调用瀑布图
  | 'memory'      // 全局长期记忆（双来源）
  | 'metacog'     // 元认知：预算预测校准
  | 'drift';      // 会话漂移雷达

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  maxTokens?: number;
  contextWindow?: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  description: string;
  type: 'local' | 'api';
  baseUrl?: string;
  apiKeyRequired: boolean;
  apiKeyHeader?: string;
  chatEndpoint?: string;
  modelsEndpoint?: string;
  isCustom?: boolean;
  models: ModelInfo[];
}

export interface CustomProviderCreateRequest {
  name: string;
  description?: string;
  baseUrl: string;
  apiKeyRequired?: boolean;
  apiKeyHeader?: string;
  chatEndpoint?: string;
  modelsEndpoint?: string;
  models?: ModelInfo[];
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  error?: string;
  status?: number;
  response?: {
    status: number;
    model?: string;
    content?: string;
  };
  suggestion?: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  /** false 表示用户填的是完整 URL（含端点），不再自动拼接 /chat/completions */
  autoAppendChat?: boolean;
}

/** 上下文窗口使用情况（ContextUsageBar 的输入模型） */
export interface ContextUsage {
  /** 当前上下文占用 tokens：最近一次 LLM 调用的 prompt + completion */
  contextUsed: number;
  contextPrompt: number;
  contextCompletion: number;
  /** 模型上下文窗口容量（tokens），0 表示未知 */
  contextWindow: number;
  /** 利用率 0-100（contextUsed / contextWindow） */
  percent: number;
  /** 会话累计用量（来自 usage_log 汇总） */
  cumulative: { total: number; prompt: number; completion: number };
  /** 数据来源：live=流式 usage 事件 / restored=会话恢复估算 / estimated=纯估算 / none */
  source: 'live' | 'restored' | 'estimated' | 'none';
}

export type ApiFormat = 'openai' | 'anthropic';

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
}

/** Search result entry returned by /api/agent/search */
export interface SearchResult {
  role: string;
  content: string;
  sessionId?: string;
  timestamp?: string;
}

/** Result of /api/agent/compare */
export interface CompareResult {
  provider: string;
  model: string;
  ok: boolean;
  text?: string;
  error?: string;
}

/** A single event in a trajectory log */
export interface TrajectoryEvent {
  turnIdx: number;
  stepIdx: number;
  type: string;
  [key: string]: unknown;
}

/** Raw message row returned by /api/sessions/:id/messages — maps to Message with created_at → timestamp conversion. */
export interface DbMessage {
  id: string;
  session_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: string;
  tool_call_id?: string | null;
  name?: string | null;
  created_at: string;
}