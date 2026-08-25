import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentChat } from '../AgentChat';
import { agentApi, sessionApi, workflowApi } from '../../api/client';

// ── Mock dependencies ────────────────────────────────────────
vi.mock('../../api/client', () => {
  const mockFn = () => vi.fn();
  return {
    agentApi: { chat: mockFn(), getTools: mockFn(), search: mockFn(), fork: mockFn() },
    sessionApi: { getMessages: mockFn() },
    workflowApi: { run: mockFn() },
  };
});

// Mock i18n — deterministic translations for assertability
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const map: Record<string, (p?: Record<string, unknown>) => string> = {
          'chat.welcome':            () => 'Welcome message',
          'chat.thinking':           () => 'Thinking…',
          'chat.toolCalled':         ({ toolName, args }: any) => `🔧 Calling tool: ${toolName}(${args})`,
          'chat.usingTool':          ({ toolName }: any) => `Using ${toolName}...`,
          'chat.toolResult':         ({ name, result }: any) => `✅ ${name} returned: ${result}`,
          'chat.approvalPending':    ({ toolName }: any) => `⚠️ Tool "${toolName}" requires user approval`,
          'chat.error':              ({ message }: any) => `❌ Error: ${message}`,
          'chat.unknownError':       () => 'unknown error',
          'chat.requestFailed':      ({ message }: any) => `❌ Request failed: ${message}`,
          'chat.checkBackend':       () => 'please check backend',
          'chat.forked':             () => 'Copied to new session',
          'chat.forkFailed':         ({ message }: any) => `❌ Fork failed: ${message}`,
          'chat.searching':          () => 'Searching…',
          'chat.search':             () => 'Search',
          'chat.clear':              () => 'Clear',
          'chat.noResults':          () => 'No results',
          'chat.supportTools':       () => 'Supports tool calls',
          'chat.availableTools':     ({ count }: any) => `Available tools (${count})`,
          'chat.toolCount':          ({ count }: any) => `Agent can use ${count} tools`,
          'chat.searchPlaceholder':  () => 'Search history…',
          'chat.timeout':            ({ seconds }: any) => `${seconds}s timeout`,
          'chat.toolRequest':        ({ toolName }: any) => `Tool code${toolName} request`,
          'chat.approve':            () => '✅ Approve',
          'chat.deny':               () => '❌ Deny',
          'chat.autorunOff':         () => 'Disable AutoRun',
          'chat.autorunOn':          () => 'AutoRun on',
          'chat.fileTrackerEnable':  () => 'Enable file tracking',
          'chat.fileTrackerDisable': () => 'Disable file tracking',
          'chat.placeholder':        () => 'Type a message…',
          'chat.send':               () => 'Send',
          'chat.stop':               () => 'Stop',
          'chat.newChat':            () => 'New chat',
          'chat.searchChat':         () => 'Search conversation',
          'chat.branch':             () => 'Branch',
          'chat.workflow':           () => 'Workflow',
          'chat.thinkingMode':       () => 'Thinking',
          'chat.thinkingModeHint':   () => 'Deep thinking',
          'chat.waitingApproval':    () => 'Awaiting approval',
          'chat.fileTracker':        () => 'File tracking',
          'tools.title':             () => 'Tools',
        };
        return map[key]?.(params) ?? key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn(), on: vi.fn(), isInitialized: true },
    }),
  };
});

const mockGetTools      = vi.mocked(agentApi.getTools);
const mockChat          = vi.mocked(agentApi.chat);
const mockSearch        = vi.mocked(agentApi.search);
const mockFork          = vi.mocked(agentApi.fork);
const mockGetMessages   = vi.mocked(sessionApi.getMessages);
const mockWorkflowRun   = vi.mocked(workflowApi.run);

const defaultProps = {
  selectedModel: 'gpt-4o',
  provider: 'openai',
  providerBaseUrl: 'https://api.openai.com/v1',
  providerApiKey: 'sk-test',
  sessionId: '',
  onSessionIdChange: vi.fn(),
};

/** Flush all pending microtasks (Promise.resolve chains from mock APIs). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('AgentChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default tools response — makes tool panel show 2 tools with 1 requiring approval
    mockGetTools.mockResolvedValue([
      { name: 'web_search', description: 'Search the web', requiresApproval: false },
      { name: 'execute_code', description: 'Run code', requiresApproval: true },
    ]);
    // Default: no session history loaded
    mockGetMessages.mockResolvedValue([]);
  });

  // ── Mount & rendering ──────────────────────────────────────
  it('renders the welcome message on mount', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    expect(screen.getByText('Welcome message')).toBeInTheDocument();
  });

  it('shows the tool count after tools load', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    expect(screen.queryAllByText(/Agent can use 2 tools/i).length).toBeGreaterThan(0);
  });

  it('shows the "Supports tool calls" label', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    expect(screen.getByText('Supports tool calls')).toBeInTheDocument();
  });

  it('renders the input textarea and send button', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();
    expect(screen.getByTitle('Send')).toBeInTheDocument();
    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();
  });

  // ── Sending a message ──────────────────────────────────────
  it('appends the user message to the chat on send', async () => {
    mockChat.mockResolvedValue({ response: 'Hello!', sessionId: 's1' });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTitle('Send'));
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('calls agentApi.chat with correct arguments', async () => {
    mockChat.mockResolvedValue({ response: 'Hi', sessionId: '' });
    render(
      <AgentChat
        {...defaultProps}
        providerBaseUrl="https://api.example.com"
        providerApiKey="my-key"
      />
    );
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => {
      expect(mockChat).toHaveBeenCalledWith(
        'test', undefined, 'gpt-4o', 'openai',
        'https://api.example.com', 'my-key', '',
        expect.any(Function), expect.any(AbortSignal), false, false,
      );
    });
  });

  it('shows the Stop button while the request is in-flight', async () => {
    // Return a promise that never resolves so the request stays "in-flight"
    mockChat.mockReturnValue(new Promise(() => {}));
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByTitle('Stop')).toBeInTheDocument());
  });

  it('replaces Stop with Send after the response arrives', async () => {
    mockChat.mockResolvedValue({ response: 'ok', sessionId: '' });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => {
      expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();
      expect(screen.getByTitle('Send')).toBeInTheDocument();
    });
  });

  // ── Stream events ──────────────────────────────────────────
  it('renders a tool_call event as a message bubble', async () => {
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'tool_call', toolCall: { id: 't1', function: { name: 'web_search', arguments: '{"q":"x"}' } } });
      cb({ type: 'text', content: 'Here is the result.' });
      cb({ type: 'done', sessionId: '' });
      return { response: 'Here is the result.', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'search' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByText(/🔧 Calling tool/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Here is the result/i)).toBeInTheDocument());
  });

  it('renders a tool_result event as a message bubble', async () => {
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'tool_call', toolCall: { id: 't1', function: { name: 'execute_code', arguments: '{}' } } });
      cb({ type: 'tool_result', toolResult: { name: 'execute_code', result: '42' } });
      cb({ type: 'done', sessionId: '' });
      return { response: '42', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'run' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByText(/execute_code returned/i)).toBeInTheDocument());
  });

  it('renders an approval_pending event and shows the approval card', async () => {
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'approval_pending', approval: { toolName: 'write_file', args: {}, approvalKey: 'k1', output: '' } });
      cb({ type: 'done', sessionId: '' });
      return { response: '', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'write' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getAllByText(/Tool "write_file" requires user approval/i).length).toBeGreaterThan(0));
  });

  it('approves a pending tool call via fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'approval_pending', approval: { toolName: 'rm', args: {}, approvalKey: 'k2', output: '' } });
      cb({ type: 'done', sessionId: '' });
      return { response: '', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByTitle('Send'));
    await flush();
    await flush();
    await waitFor(() => expect(screen.getByText(/Approve/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Approve/i));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/approve'),
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('approve') }),
    ));
    fetchSpy.mockRestore();
  });

  it('denies a pending tool call via fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'approval_pending', approval: { toolName: 'rm', args: {}, approvalKey: 'k3', output: '' } });
      cb({ type: 'done', sessionId: '' });
      return { response: '', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByTitle('Send'));
    await flush();
    await flush();
    await waitFor(() => expect(screen.getByText(/Deny/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Deny/i));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/approve'),
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('deny') }),
    ));
    fetchSpy.mockRestore();
  });

  it('renders an error event as a message bubble', async () => {
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'error', error: 'connection refused' });
      return { response: '', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByText(/❌ Error/i)).toBeInTheDocument());
  });

  it('handles a rejected chat promise gracefully', async () => {
    mockChat.mockRejectedValue(new Error('Network error'));
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByText(/❌ Request failed/i)).toBeInTheDocument());
  });

  // ── Search ─────────────────────────────────────────────────
  it('toggles the search panel', () => {
    render(<AgentChat {...defaultProps} />);
    const btn = screen.getByTitle('Search conversation');
    fireEvent.click(btn);
    expect(screen.getByPlaceholderText('Search history…')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByPlaceholderText('Search history…')).not.toBeInTheDocument();
  });

  it('shows Searching… while search is in progress', async () => {
    mockSearch.mockReturnValue(new Promise(() => {}));
    render(<AgentChat {...defaultProps} />);
    const btn = screen.getByTitle('Search conversation');
    fireEvent.click(btn);
    const input = screen.getByPlaceholderText('Search history…');
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('Searching…')).toBeInTheDocument());
  });

  it('shows search results when they exist', async () => {
    mockSearch.mockResolvedValue({ results: [{ role: 'user', content: 'foo bar' }] });
    render(<AgentChat {...defaultProps} />);
    const btn = screen.getByTitle('Search conversation');
    fireEvent.click(btn);
    const input = screen.getByPlaceholderText('Search history…');
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('foo bar')).toBeInTheDocument());
  });

  it('shows No results when search returns empty', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    render(<AgentChat {...defaultProps} />);
    const btn = screen.getByTitle('Search conversation');
    fireEvent.click(btn);
    const input = screen.getByPlaceholderText('Search history…');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
  });

  it('clears search results and query', async () => {
    mockSearch.mockResolvedValue({ results: [{ role: 'user', content: 'hit' }] });
    render(<AgentChat {...defaultProps} />);
    const btn = screen.getByTitle('Search conversation');
    fireEvent.click(btn);
    const input = screen.getByPlaceholderText('Search history…');
    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('hit')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByText('hit')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  // ── Clear chat ─────────────────────────────────────────────
  it('resets to the welcome message and clears sessionId on clear', async () => {
    mockChat.mockResolvedValue({ response: 'hi', sessionId: 's1' });
    render(<AgentChat {...defaultProps} sessionId="s1" />);
    await flush();
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New chat'));
    await waitFor(() => {
      expect(screen.getByText('Welcome message')).toBeInTheDocument();
      expect(defaultProps.onSessionIdChange).toHaveBeenCalledWith('');
    });
  });

  // ── Fork session ───────────────────────────────────────────
  it('forks the current session and updates sessionId', async () => {
    mockFork.mockResolvedValue({ newSessionId: 's2' });
    mockGetMessages.mockResolvedValue([]);
    render(<AgentChat {...defaultProps} sessionId="s1" />);
    await flush();
    fireEvent.click(screen.getByTitle('Branch'));
    await waitFor(() => {
      expect(screen.getByText('Copied to new session')).toBeInTheDocument();
      expect(defaultProps.onSessionIdChange).toHaveBeenCalledWith('s2');
    });
  });

  it('shows a fork error message on failure', async () => {
    mockFork.mockRejectedValue(new Error('fork failed'));
    render(<AgentChat {...defaultProps} sessionId="s1" />);
    await flush();
    fireEvent.click(screen.getByTitle('Branch'));
    await waitFor(() => {
      expect(screen.getByText(/❌.*fork/i)).toBeInTheDocument();
    });
  });

  // ── Tool list panel ────────────────────────────────────────
  it('toggles the tools panel', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    const btn = screen.getByTitle('Tools');
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText('Available tools (2)')).toBeInTheDocument());
    fireEvent.click(btn);
    expect(screen.queryByText('Available tools (2)')).not.toBeInTheDocument();
  });

  it('shows an approval warning icon for tools that require approval', async () => {
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      cb({ type: 'approval_pending', approval: { toolName: 'rm', args: {}, approvalKey: 'k2', output: '' } });
      cb({ type: 'done', sessionId: '' });
      return { response: '', sessionId: '' };
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByTitle('Send'));
    await flush();
    await flush();
    await waitFor(() => expect(screen.getAllByText(/requires user approval/i).length).toBeGreaterThan(0));
  });

  // ── AutoRun & Thinking toggles ─────────────────────────────
  it('toggles AutoRun and updates the button title', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    const btn = screen.getByText('AutoRun').closest('button');
    expect(btn).toHaveAttribute('title', 'Disable AutoRun');
    fireEvent.click(btn!);
    expect(btn).toHaveAttribute('title', 'AutoRun on');
  });

  it('toggles the thinking mode button', () => {
    render(<AgentChat {...defaultProps} />);
    const btn = screen.getByTitle('Deep thinking').closest('button');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn!);
  });

  // ── File tracker ───────────────────────────────────────────
  it('toggles file tracker and updates the button title', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    const btn = screen.getByTitle('Enable file tracking').closest('button');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn!);
    expect(btn).toHaveAttribute('title', 'Disable file tracking');
    fireEvent.click(btn!);
    expect(btn).toHaveAttribute('title', 'Enable file tracking');
  });

  // ── Enter key sends message ────────────────────────────────
  it('sends the message when Enter is pressed', async () => {
    mockChat.mockResolvedValue({ response: 'ok', sessionId: '' });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'hello' } });
    await flush();
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    await flush();
    await waitFor(() => {
      expect(mockChat).toHaveBeenCalledWith(
        'hello', undefined, 'gpt-4o', 'openai',
        'https://api.openai.com/v1', 'sk-test', '',
        expect.any(Function), expect.any(AbortSignal), false, false,
      );
    });
  });

  it('does not send when Shift+Enter is pressed', async () => {
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(mockChat).not.toHaveBeenCalled());
  });

  // ── Session restore on mount ───────────────────────────────
  it('loads prior messages when a sessionId is provided', async () => {
    mockGetMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'hi', created_at: '2025-01-01T00:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'hello', created_at: '2025-01-01T00:00:01Z' },
    ]);
    render(<AgentChat {...defaultProps} sessionId="existing-session" />);
    await flush();
    expect(mockGetMessages).toHaveBeenCalledWith('existing-session');
    // Historical messages should appear
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shows the welcome placeholder when history is empty', async () => {
    mockGetMessages.mockResolvedValue([]);
    render(<AgentChat {...defaultProps} sessionId="empty-session" />);
    await flush();
    expect(mockGetMessages).toHaveBeenCalledWith('empty-session');
    // With empty history the welcome placeholder remains
    expect(screen.getByText('Welcome message')).toBeInTheDocument();
  });

  // ── Workflow mode ──────────────────────────────────────────
  it('uses workflowApi.run when workflow mode is active', async () => {
    mockWorkflowRun.mockResolvedValue({ response: 'wf-res', sessionId: '' });
    render(<AgentChat {...defaultProps} />);
    await flush();
    const btn = screen.getByTitle('Workflow').closest('button');
    fireEvent.click(btn!); // toggle workflow mode on
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'run workflow' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => {
      expect(mockWorkflowRun).toHaveBeenCalledWith(
        'run workflow', undefined, 'gpt-4o', 'openai',
        'https://api.openai.com/v1', 'sk-test', '',
        expect.any(Function), expect.any(AbortSignal), false,
      );
    });
  });

  it('defaults to agentApi.chat (workflow off)', async () => {
    mockChat.mockResolvedValue({ response: 'ok', sessionId: '' });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => {
      expect(mockChat).toHaveBeenCalled();
      expect(mockWorkflowRun).not.toHaveBeenCalled();
    });
  });

  // ── Stop / abort ───────────────────────────────────────────
  it('aborts the in-flight request when Stop is clicked', async () => {
    const abortSpy = vi.fn();
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, _cb, signal?: AbortSignal) => {
      signal?.addEventListener('abort', abortSpy);
      return new Promise<{ response: string; sessionId: string }>(() => {});
    });
    render(<AgentChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'long' } });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByTitle('Stop')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Stop'));
    await waitFor(() => expect(abortSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTitle('Stop')).not.toBeInTheDocument());
  });

  it('shows Send button before any request is made', async () => {
    render(<AgentChat {...defaultProps} />);
    await flush();
    expect(screen.getByTitle('Send')).toBeInTheDocument();
    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();
  });

  // ── Network interruption: tok/s resets to 0 ────────────────
  it('resets tok/s display and streamUsage after network interruption mid-stream', async () => {
    // Simulate: stream sends some text events, then the connection breaks mid-stream.
    mockChat.mockImplementation(async (_m, _s, _mod, _p, _b, _k, _sys, cb) => {
      // Send a few streaming chunks to populate streamingTokensRef
      cb({ type: 'text', content: 'Hello ' });
      cb({ type: 'text', content: 'world, ' });
      cb({ type: 'text', content: 'this is a ' });
      cb({ type: 'text', content: 'long streaming ' });
      cb({ type: 'text', content: 'response ' });

      // Wait a tick, then simulate network interruption
      await new Promise<void>(r => setTimeout(r, 200));

      // Reject to simulate sudden disconnection — no 'usage' or 'done' event follows
      throw new Error('NetworkError: connection reset');
    });

    render(<AgentChat {...defaultProps} />);
    await flush();

    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'test stream' } });
    fireEvent.click(screen.getByTitle('Send'));

    // 1) Verify streaming badge appears during the stream
    await waitFor(() => {
      expect(screen.getByTitle('Stop')).toBeInTheDocument();
    });

    // 2) Wait for the network interruption to be caught
    await waitFor(() => {
      expect(screen.getByText(/❌ Request failed/i)).toBeInTheDocument();
    });

    // 3) tok/s badge should be gone — no amber "tok/s" pill anywhere in DOM
    const tokSpills = screen.queryAllByText(/tok\/s/);
    expect(tokSpills).toHaveLength(0);

    // 4) Send button reappears (loading ended)
    expect(screen.getByTitle('Send')).toBeInTheDocument();
    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();

    // 5) Send another message to confirm the next session starts clean
    fireEvent.change(input, { target: { value: 'retry' } });
    mockChat.mockResolvedValue({ response: 'ok', sessionId: '' });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(screen.getByText('ok')).toBeInTheDocument());
  });
});
