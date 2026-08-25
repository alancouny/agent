export interface AgentConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxIterations: number;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  /** 模型上下文窗口容量（tokens）。由路由层从模型目录解析，随 usage 事件下发供前端展示利用率。 */
  contextWindow?: number;
  /** 思考模式：Anthropic extended thinking / OpenAI reasoning_effort */
  thinkingMode?: boolean;
  /** 思考预算 tokens（Anthropic thinking.budget_tokens，缺省 2048） */
  thinkingBudgetTokens?: number;
  /** 外部中止信号（SSE 断连等）：agent 在 LLM 调用间隙/循环头部检查并提前终止 */
  signal?: AbortSignal;
  hooks?: import('./hooks.js').AgentHooksConfig;
  /** Ordered fallback models tried (in sequence) if the primary call throws. */
  fallbacks?: { provider: string; model: string; baseUrl?: string; apiKey?: string }[];
  /** LLM 调用追踪（瀑布图）：层级标记 + 父调用依赖。由路由层注入，AgentCore 无感知埋点。 */
  telemetry?: {
    agentKind?: 'main' | 'delegate' | 'supervisor' | 'worker';
    parentCallId?: string | null;
  };
  /** 长期记忆注入：run() 开始时按相关性检索并追加到系统提示（仅读）。 */
  memory?: { enabled: boolean; topK?: number };
  /** 元认知：回答前预测计算预算（工具调用数/token），run 后与实测对比（校准研究）。 */
  metacognition?: { enabled: boolean };
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentState {
  sessionId: string;
  config: AgentConfig;
  messages: AgentMessage[];
  iteration: number;
  isComplete: boolean;
  error?: string;
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'approval_pending' | 'error' | 'complete' | 'thinking' | 'done' | 'file_modified' | 'context_compressed';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: { name: string; result: string };
  approval?: { toolName: string; args: Record<string, unknown>; approvalKey: string; output: string };
  error?: string;
  sessionId?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; contextWindow?: number };
  /** DeepSeek-Harness-style framing: one turn = one user request; one step = one model call + its tool runs. */
  turnIdx?: number;
  stepIdx?: number;
  /** 文件被 AI 修改时附带（write_file / run_code 写入文件） */
  fileModified?: {
    path: string;
    operation: 'write' | 'create';
    lineCount?: number;
    snippet?: string;
  };
  /** 上下文压缩后触发：告知前端当前分层状态 */
  contextCompressed?: {
    /** 压缩前估算 tokens */
    beforeTokens: number;
    /** 压缩后估算 tokens */
    afterTokens: number;
    /** 节省的 tokens */
    savings: number;
    /** 各层消息数 */
    layers: { recent: number; compressed: number; discarded: number };
    /** 当前使用率 */
    usageRatio: number;
  };
}