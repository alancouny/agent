import { useState, useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { apiUrl, getAgentApiKey } from '../apiConfig';
import { useTranslation } from 'react-i18next';
import type { Message, AgentStreamEvent, AgentTool, DbMessage, SearchResult, ToolCall } from '../types';
import { agentApi, sessionApi, workflowApi } from '../api/client';
import { TrajectoryDrawer } from './TrajectoryDrawer';
import { FileTrackerPanel } from './FileTrackerPanel';
import { useContextUsage, estimateTokens } from '../hooks/useContextUsage';
import { useTTS } from '../hooks/useTTS';
import type { TrackedFile } from './FileTrackerPanel';
import { ChatHeader } from './chat/ChatHeader';
import { ChatMessageList } from './chat/ChatMessageList';
import { ChatInput } from './chat/ChatInput';
import { ChatSearchPanel } from './chat/ChatSearchPanel';
import { ToolsBadgePanel } from './chat/ToolsBadgePanel';
import type { StreamUsage, PendingApproval } from './chat/types';

interface AgentChatProps {
  selectedModel: string;
  provider: string;
  providerBaseUrl?: string;
  providerApiKey?: string;
  sessionId: string;
  onSessionIdChange: (id: string) => void;
}

/** 裸 fetch 需要手动带 Bearer 头（后端 T01 起强制鉴权；axios 拦截器已自动处理）。 */
function authHeader(): Record<string, string> {
  const key = getAgentApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function AgentChat({ selectedModel, provider, providerBaseUrl, providerApiKey, sessionId, onSessionIdChange }: AgentChatProps) {
  const { t } = useTranslation();
  const { settings: ttsSettings, playingId, isPaused, speak, stop, error: ttsError } = useTTS();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: t('chat.welcome'),
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [showTools, setShowTools] = useState(false);
  const [thinking, setThinking] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [autoRun, setAutoRun] = useState(false);

  // Conversation search (full-text across messages)
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showTrajectory, setShowTrajectory] = useState(false);

  // ── File Tracker ──
  const [fileTrackerEnabled, setFileTrackerEnabled] = useState(false);
  const [trackedFiles, setTrackedFiles] = useState<TrackedFile[]>([]);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);

  // ── Workflow 模式（LangGraph 风格 supervisor StateGraph）──
  const [workflowMode, setWorkflowMode] = useState(false);

  // ── 思考模式（Anthropic extended thinking / OpenAI reasoning_effort）──
  const [thinkingMode, setThinkingMode] = useState(false);

  // ── 上下文窗口使用情况（实时流式展示）──
  const { usage: ctxUsage, consumeUsage, setModel: ctxSetModel, restore: ctxRestore, reset: ctxReset } = useContextUsage();
  const lastRestoredRef = useRef('');
  const messagesRef = useRef<Message[]>(messages);

  // 镜像最新消息，供会话恢复时估算当前上下文占用
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 会话变化时恢复上下文用量（首条消息产生新会话 / 会话恢复 / fork）
  useEffect(() => {
    if (!sessionId || lastRestoredRef.current === sessionId) return;
    lastRestoredRef.current = sessionId;
    void ctxSetModel(provider, selectedModel);
    ctxRestore(sessionId, messagesRef.current);
  }, [sessionId, provider, selectedModel, ctxSetModel, ctxRestore]);

  // Token usage stats for the latest assistant response
  const [streamUsage, setStreamUsage] = useState<StreamUsage | null>(null);
  // 是否在当前 session 触发过上下文压缩
  const [contextCompressed, setContextCompressed] = useState(false);

  const elapsedStartRef = useRef<number | null>(null);
  // 流式过程中的实时 token 计数（估算），用于计算跳动的 tok/s
  const streamingTokensRef = useRef(0);
  // 标记当前响应是否已结束（用于切换 live → 最终统计）
  const streamDoneRef = useRef(false);
  // 累积当前回合的思考文本，流结束后一次性朗读
  const thinkingTextRef = useRef('');

  // 实时秒数/tok/s 由 LiveStats / ElapsedBadge 子组件自行 tick，避免每 100ms 重渲染整个聊天树
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // ── 消息列表虚拟化：超过阈值才启用（长会话滚动性能关键；小列表走直接渲染，保持行为一致）──
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const useVirtual = messages.length > 60;
  const virtualizer = useVirtualizer({
    count: useVirtual ? messages.length : 0,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: () => 140,
    overscan: 8,
  });

  useEffect(() => {
    if (useVirtual && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    } else {
      // 自动滚动到底部（不用 smooth：流式高频触发时平滑滚动代价高且抖）
      messagesEndRef.current?.scrollIntoView();
    }
  // useVirtual/virtualizer are refs that change on every render; excluding them is intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, thinking]);

  useEffect(() => {
    agentApi.getTools().then(t => setTools(t)).catch(() => {});
  }, []);

  // 组件卸载时中止进行中的流式请求，避免卸载后 setState / 泄漏
  useEffect(() => () => abortRef.current?.abort(), []);

  // Restore conversation whenever the sessionId changes（覆盖挂载恢复 / fork / 新会话），
  // 带取消标志避免慢响应覆盖更新的会话状态。
  const loadedSessionRef = useRef('');
  useEffect(() => {
    const sid = sessionId;
    if (!sid || loadedSessionRef.current === sid) return;
    loadedSessionRef.current = sid;
    let cancelled = false;
    sessionApi.getMessages(sid)
      .then((msgs) => {
        if (cancelled) return;
        const restored: Message[] = msgs.map((m: DbMessage) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
          tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) as ToolCall[] : undefined,
          tool_call_id: m.tool_call_id ?? undefined,
          name: m.name ?? undefined,
        }));
        if (restored.length > 0) setMessages(restored);
      })
      .catch(() => {
        // ignore — keep the welcome placeholder
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      const existing = prev.find(m => m.id === msg.id);
      if (existing) {
        return prev.map(m => m.id === msg.id ? { ...m, ...msg } : m);
      }
      return [...prev, msg];
    });
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setThinking(t('chat.thinking'));
    setStreamUsage(null);
    elapsedStartRef.current = performance.now();
    streamingTokensRef.current = 0;
    streamDoneRef.current = false;
    // 新一轮对话：归零上下文展示并解析当前模型窗口容量
    ctxReset();
    void ctxSetModel(provider, selectedModel);

    // Add a streaming placeholder
    const streamMsgId = `stream-${Date.now()}`;
    addMessage({
      id: streamMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    });

    // Track tool calls visually
    const toolCallsInProgress: string[] = [];

    try {
      abortRef.current = new AbortController();
      const chatFn = workflowMode
        ? (cb: (event: AgentStreamEvent) => void, sig?: AbortSignal) =>
            workflowApi.run(
              userMessage.content,
              sessionId || undefined,
              selectedModel,
              provider,
              providerBaseUrl,
              providerApiKey,
              '',
              cb,
              sig,
              thinkingMode
            )
        : (cb: (event: AgentStreamEvent) => void, sig?: AbortSignal) =>
            agentApi.chat(
              userMessage.content,
              sessionId || undefined,
              selectedModel,
              provider,
              providerBaseUrl,
              providerApiKey,
              '',
              cb,
              sig,
              autoRun,
              thinkingMode
            );
      await chatFn((event: AgentStreamEvent) => {
          switch (event.type) {
            case 'thinking':
              setThinking(event.content || '处理中...');
              // 累积思考文本，供流结束后朗读
              thinkingTextRef.current += event.content || '';
              break;
            case 'text':
              // 流式过程中实时更新 token 计数（估算），用于跳动显示 tok/s
              streamingTokensRef.current = estimateTokens(event.content || '');
              // Capture usage reported by the backend with each LLM response.
              // NOTE: We must NOT read `elapsedMs` state here — the callback
              // is captured by agentApi.chat() once and won't re-close over
              // later state updates, so `elapsedMs` would be stale (usually null).
              // Use the ref directly instead (refs always read the latest value).
              if (event.usage) {
                streamDoneRef.current = true;
                const dur = elapsedStartRef.current
                  ? (performance.now() - elapsedStartRef.current) / 1000
                  : 0.001;
                setStreamUsage({
                  totalTokens: event.usage.totalTokens || 0,
                  completionTokens: event.usage.completionTokens || 0,
                  promptTokens: event.usage.promptTokens || 0,
                  tokensPerSecond: Math.round((event.usage.completionTokens || 0) / Math.max(dur, 0.001)),
                  elapsedSeconds: Math.round(dur * 100) / 100,
                });
                // 实时刷新上下文窗口利用率（多步 Agent 每次 LLM 调用都会增长）
                consumeUsage(event.usage);
              }
              addMessage({
                id: streamMsgId,
                role: 'assistant',
                content: event.content || '',
                timestamp: new Date(),
                isStreaming: true,
              });
              setThinking('');
              break;
            case 'tool_call':
              if (event.toolCall) {
                const toolName = event.toolCall.function.name;
                toolCallsInProgress.push(toolName);
                const toolMsg: Message = {
                  id: `tool-${event.toolCall.id}`,
                  role: 'tool',
                  content: t('chat.toolCalled', { toolName, args: event.toolCall.function.arguments }),
                  timestamp: new Date(),
                  tool_call_id: event.toolCall.id,
                  name: toolName,
                };
                addMessage(toolMsg);
                setThinking(t('chat.usingTool', { toolName }));
              }
              break;
            case 'tool_result':
              if (event.toolResult) {
                const toolMsg: Message = {
                  id: `toolresult-${Date.now()}-${Math.random()}`,
                  role: 'tool',
                  content: t('chat.toolResult', { name: event.toolResult.name, result: event.toolResult.result.substring(0, 500) }),
                  timestamp: new Date(),
                  name: event.toolResult.name,
                };
                addMessage(toolMsg);
                setThinking('');
              }
              break;
            case 'approval_pending':
              if (event.approval) {
                const approvalMsg: Message = {
                  id: `approval-${Date.now()}`,
                  role: 'tool',
                  content: t('chat.approvalPending', { toolName: event.approval.toolName }),
                  timestamp: new Date(),
                  name: event.approval.toolName,
                };
                addMessage(approvalMsg);
                setPendingApproval({
                  toolName: event.approval.toolName,
                  args: event.approval.args,
                  approvalKey: event.approval.approvalKey,
                  output: event.approval.output,
                });
                setThinking(t('chat.waitingApproval'));
              }
              break;
            case 'error':
              addMessage({
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: t('chat.error', { message: event.error || t('chat.unknownError') }),
                timestamp: new Date(),
              });
              setThinking('');
              break;
            case 'done':
              if (event.sessionId) {
                onSessionIdChange(event.sessionId);
              }
              setThinking('');
              setIsLoading(false);
              break;
            case 'complete':
              setThinking('');
              break;
            case 'context_compressed':
              setContextCompressed(true);
              break;
            case 'file_modified':
              if (event.fileModified && fileTrackerEnabled) {
                const fm = event.fileModified;
                const tracked: TrackedFile = {
                  id: fm.path,
                  path: fm.path,
                  displayName: fm.path.split('/').pop() ?? fm.path,
                  operation: fm.operation,
                  lineCount: fm.lineCount ?? 0,
                  snippet: fm.snippet ?? '',
                  updatedAt: Date.now(),
                };
                setTrackedFiles(prev => {
                  const idx = prev.findIndex(f => f.id === tracked.id);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = tracked;
                    return next;
                  }
                  return [...prev, tracked];
                });
                // 首次写入自动展开
                setExpandedFileId(prev => prev ?? tracked.id);
              }
              break;
          }
        }, abortRef.current.signal).then(({ response, sessionId: newSessionId }) => {
        if (response) {
          addMessage({
            id: streamMsgId,
            role: 'assistant',
            content: response,
            timestamp: new Date(),
            isStreaming: false,
          });
        } else {
          // Remove streaming placeholder if no content
          setMessages(prev => prev.filter(m => m.id !== streamMsgId));
        }
        if (newSessionId) {
          onSessionIdChange(newSessionId);
        }
        setIsLoading(false);
        setThinking('');
        // 流结束后朗读累积的思考内容（如果用户开启了朗读思考）
        const accumulatedThinking = thinkingTextRef.current;
        thinkingTextRef.current = '';
        if (ttsSettings.readThinking && accumulatedThinking.trim() && !playingId) {
          speak(`thinking-${Date.now()}`, accumulatedThinking.trim());
        }
      }).catch((err) => {
        if (err.name === 'AbortError') return;
        elapsedStartRef.current = null;
        streamingTokensRef.current = 0;
        setStreamUsage(null);
        setMessages(prev => prev.filter(m => m.id !== streamMsgId));
        addMessage({
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: t('chat.requestFailed', { message: err.message || t('chat.checkBackend') }),
          timestamp: new Date(),
        });
        setIsLoading(false);
        setThinking('');
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      elapsedStartRef.current = null;
      streamingTokensRef.current = 0;
      setStreamUsage(null);
      setMessages(prev => prev.filter(m => m.id !== streamMsgId));
      addMessage({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: t('chat.error', { message }),
        timestamp: new Date(),
      });
      setIsLoading(false);
      setThinking('');
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    elapsedStartRef.current = null;
    streamingTokensRef.current = 0;
    setStreamUsage(null);
    setIsLoading(false);
    setThinking('');
    setMessages(prev => prev.filter(m => !m.isStreaming));
  };

  const handleApproveTool = async (approvalKey: string) => {
    try {
      await fetch(apiUrl('/api/agent/tools/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ approvalKey, action: 'approve' }),
      });
    } catch { /* ignore */ }
    setPendingApproval(null);
  };

  const handleDenyTool = async (approvalKey: string) => {
    try {
      await fetch(apiUrl('/api/agent/tools/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ approvalKey, action: 'deny' }),
      });
    } catch { /* ignore */ }
    setPendingApproval(null);
  };

  const handleClear = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: t('chat.welcome'),
        timestamp: new Date(),
      },
    ]);
    onSessionIdChange('');
    lastRestoredRef.current = '';
    ctxReset();
  };

  const handleFork = async () => {
    if (!sessionId) return;
    try {
      const res = await agentApi.fork(sessionId);
      const msgs = await sessionApi.getMessages(res.newSessionId);
      const restored: Message[] = msgs.map((m: DbMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at),
        tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) as ToolCall[] : undefined,
        tool_call_id: m.tool_call_id ?? undefined,
        name: m.name ?? undefined,
      }));
      setMessages(restored.length > 0 ? restored : [{
        id: 'welcome', role: 'assistant',
        content: t('chat.forked'),
        timestamp: new Date(),
      }]);
      onSessionIdChange(res.newSessionId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`, role: 'assistant',
        content: t('chat.forkFailed', { message }), timestamp: new Date(),
      }]);
    }
  };

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const res = await agentApi.search(searchQ, sessionId || undefined);
      setSearchResults(res.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          toolCount={tools.length}
          showTools={showTools}
          onToggleTools={() => setShowTools(s => !s)}
          onClear={handleClear}
          onFork={handleFork}
          canFork={!!sessionId}
          showSearch={showSearch}
          onToggleSearch={() => setShowSearch(s => !s)}
          showTrajectory={showTrajectory}
          onToggleTrajectory={() => setShowTrajectory(s => !s)}
          canTrajectory={!!sessionId}
          workflowMode={workflowMode}
          onToggleWorkflow={() => setWorkflowMode(w => !w)}
          fileTrackerEnabled={fileTrackerEnabled}
          onToggleFileTracker={() => setFileTrackerEnabled(v => !v)}
          trackedFileCount={trackedFiles.length}
          ctxUsage={ctxUsage}
          model={selectedModel}
          streaming={isLoading}
          contextCompressed={contextCompressed}
        />

        {/* Trajectory drawer (Harness-style session log replay) */}
        {showTrajectory && sessionId && (
          <TrajectoryDrawer
            sessionId={sessionId}
            onClose={() => setShowTrajectory(false)}
            onSteered={(msg) => {
              // Surface the steered message in the chat so the user sees it took effect.
              addMessage({
                id: `steer-${Date.now()}`,
                role: 'user',
                content: `⚡ (steer) ${msg}`,
                timestamp: new Date(),
              });
            }}
          />
        )}

        {/* Tools Panel (collapsible) */}
        {showTools && <ToolsBadgePanel tools={tools} />}

        {/* Search panel (full-text across messages) */}
        {showSearch && (
          <ChatSearchPanel
            searchQ={searchQ}
            onSearchChange={setSearchQ}
            onSearch={handleSearch}
            searching={searching}
            results={searchResults}
            onClear={() => { setSearchResults([]); setSearchQ(''); }}
          />
        )}

        {/* Messages */}
        <ChatMessageList
          messages={messages}
          useVirtual={useVirtual}
          virtualizer={virtualizer}
          scrollRef={messagesScrollRef}
          endRef={messagesEndRef}
          ttsError={ttsError}
          thinking={thinking}
          elapsedStartRef={elapsedStartRef}
          streamingTokensRef={streamingTokensRef}
          pendingApproval={pendingApproval}
          onApprove={handleApproveTool}
          onDeny={handleDenyTool}
          streamUsage={streamUsage}
          playingId={playingId}
          isPaused={isPaused}
          onSpeak={speak}
          onStopSpeak={stop}
        />

        {/* Input */}
        <ChatInput
          input={input}
          onInputChange={setInput}
          onKeyDown={handleKeyPress}
          isLoading={isLoading}
          onSend={handleSend}
          onStop={handleStop}
          autoRun={autoRun}
          onToggleAutoRun={() => setAutoRun(v => !v)}
          thinkingMode={thinkingMode}
          onToggleThinkingMode={() => setThinkingMode(v => !v)}
          toolCount={tools.length}
        />
      </div>

      {/* File Tracker Panel（受控：files/expandedId 由本组件维护） */}
      {fileTrackerEnabled && (
        <FileTrackerPanel
          enabled={fileTrackerEnabled}
          files={trackedFiles}
          expandedId={expandedFileId}
          onExpand={(id) => setExpandedFileId(id)}
          onClear={() => setTrackedFiles([])}
          onToggle={() => setFileTrackerEnabled(false)}
          onClose={() => setFileTrackerEnabled(false)}
        />
      )}
    </div>
  );
}
