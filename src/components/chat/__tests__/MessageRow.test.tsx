import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MessageRow } from '../ChatMessageList';
import type { Message } from '../../../types';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => {
        const map: Record<string, string> = {
          'tts.speak': 'Speak',
          'tts.stop': 'Stop',
          'tts.playing': 'Playing',
        };
        return map[key] ?? key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn(), on: vi.fn(), isInitialized: true },
    }),
  };
});

const refs = {
  elapsedStartRef: { current: null } as React.MutableRefObject<number | null>,
  streamingTokensRef: { current: 0 } as React.MutableRefObject<number>,
};

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('MessageRow', () => {
  it('renders assistant message content', () => {
    render(
      <MessageRow
        message={makeMessage()}
        streamUsage={null}
        playingId={null}
        isPaused={false}
        onSpeak={vi.fn()}
        onStopSpeak={vi.fn()}
        {...refs}
      />
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders user message in reverse row layout', () => {
    const { container } = render(
      <MessageRow
        message={makeMessage({ role: 'user', content: 'hi user' })}
        streamUsage={null}
        playingId={null}
        isPaused={false}
        onSpeak={vi.fn()}
        onStopSpeak={vi.fn()}
        {...refs}
      />
    );
    expect(screen.getByText('hi user')).toBeInTheDocument();
    expect(container.querySelector('.flex-row-reverse')).not.toBeNull();
  });

  it('shows a speak button for completed assistant text and calls onSpeak', () => {
    const onSpeak = vi.fn();
    render(
      <MessageRow
        message={makeMessage()}
        streamUsage={null}
        playingId={null}
        isPaused={false}
        onSpeak={onSpeak}
        onStopSpeak={vi.fn()}
        {...refs}
      />
    );
    const btn = screen.getByTitle('Speak');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onSpeak).toHaveBeenCalledWith('m1', 'hello');
  });

  it('renders final usage stats when streamUsage is present', () => {
    render(
      <MessageRow
        message={makeMessage()}
        streamUsage={{ totalTokens: 100, completionTokens: 60, promptTokens: 40, tokensPerSecond: 20, elapsedSeconds: 3 }}
        playingId={null}
        isPaused={false}
        onSpeak={vi.fn()}
        onStopSpeak={vi.fn()}
        {...refs}
      />
    );
    expect(screen.getByText(/60 completion/)).toBeInTheDocument();
    expect(screen.getByText(/20 tok\/s/)).toBeInTheDocument();
  });
});
