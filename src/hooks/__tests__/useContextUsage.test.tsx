import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { estimateTokens, estimateContextTokens, useContextUsage } from '../useContextUsage';
import type { Message } from '../../types';
import { agentApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  agentApi: { tokens: vi.fn() },
  modelProviderApi: { getProviders: vi.fn() },
}));

const mockedTokens = vi.mocked(agentApi.tokens);

const msg = (content: string, role: Message['role'] = 'user'): Message => ({
  id: Math.random().toString(36).slice(2),
  role,
  content,
  timestamp: new Date(),
});

describe('estimateTokens', () => {
  it('counts CJK chars as 1 token each', () => {
    expect(estimateTokens('你好世界')).toBe(4);
  });

  it('counts ASCII at ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 → ceil(2.75)
  });

  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('estimateContextTokens', () => {
  it('adds system-prompt overhead to the message body estimate', () => {
    const msgs = [msg('你好世界'), msg('hello', 'assistant')];
    // 4 (CJK) + ceil(5/4)=2  → body 6 → +300 overhead
    expect(estimateContextTokens(msgs)).toBe(306);
  });
});

describe('useContextUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTokens.mockResolvedValue({ tokens: { total: 500, prompt: 300, completion: 200 } });
  });

  it('consumeUsage sets live context usage and percent from the event', () => {
    const { result } = renderHook(() => useContextUsage());

    act(() => {
      result.current.consumeUsage({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        contextWindow: 1000,
      });
    });

    expect(result.current.usage.contextUsed).toBe(150);
    expect(result.current.usage.contextPrompt).toBe(100);
    expect(result.current.usage.contextCompletion).toBe(50);
    expect(result.current.usage.contextWindow).toBe(1000);
    expect(result.current.usage.percent).toBe(15);
    expect(result.current.usage.source).toBe('live');
  });

  it('ignores usage events with no usable token count', () => {
    const { result } = renderHook(() => useContextUsage());

    act(() => {
      result.current.consumeUsage({});
    });

    expect(result.current.usage.contextUsed).toBe(0);
    expect(result.current.usage.source).toBe('none');
  });

  it('reset zeroes the display while keeping the known window', () => {
    const { result } = renderHook(() => useContextUsage());

    act(() => {
      result.current.consumeUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15, contextWindow: 2000 });
      result.current.reset();
    });

    expect(result.current.usage.contextUsed).toBe(0);
    expect(result.current.usage.contextWindow).toBe(2000);
    expect(result.current.usage.source).toBe('none');
  });

  it('restore fetches cumulative usage and estimates current context', async () => {
    const { result } = renderHook(() => useContextUsage());

    await act(async () => {
      await result.current.restore('session-1', [msg('你好世界')]);
    });

    expect(mockedTokens).toHaveBeenCalledWith('session-1');
    expect(result.current.usage.cumulative.total).toBe(500);
    expect(result.current.usage.source).toBe('restored');
    // 4 CJK tokens + 300 overhead
    expect(result.current.usage.contextUsed).toBe(304);
  });
});
