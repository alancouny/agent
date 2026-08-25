import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TrajectoryDrawer } from '../TrajectoryDrawer';

const mockTrajectory = vi.fn();
const mockSteer = vi.fn();

vi.mock('../../api/client', () => ({
  agentApi: {
    trajectory: (...args: unknown[]) => mockTrajectory(...args),
    steer: (...args: unknown[]) => mockSteer(...args),
  },
}));

const EVENTS = [
  { seq: 1, turnIdx: 1, stepIdx: 1, type: 'turn_start', createdAt: 't' },
  { seq: 2, turnIdx: 1, stepIdx: 1, type: 'user_message', content: 'hello', createdAt: 't' },
  { seq: 3, turnIdx: 1, stepIdx: 2, type: 'tool_call', toolName: 'calculator', args: '{"expression":"1+1"}', createdAt: 't' },
  { seq: 4, turnIdx: 1, stepIdx: 2, type: 'tool_result', result: '{"success":true}', createdAt: 't' },
];

const SAMPLE = {
  sessionId: 's1',
  events: EVENTS,
  turns: [
    {
      turnIdx: 1,
      steps: [
        { stepIdx: 1, events: [EVENTS[0], EVENTS[1]] },
        { stepIdx: 2, events: [EVENTS[2], EVENTS[3]] },
      ],
    },
  ],
};

describe('TrajectoryDrawer', () => {
  beforeEach(() => {
    mockTrajectory.mockResolvedValue(SAMPLE);
    mockSteer.mockResolvedValue({ ok: true });
  });

  it('renders turns and steps from the session log', async () => {
    render(<TrajectoryDrawer sessionId="s1" onClose={() => {}} onSteered={() => {}} />);
    expect(await screen.findByText('Turn 1')).toBeInTheDocument();
    expect(mockTrajectory).toHaveBeenCalledWith('s1');
  });

  it('expands a step to show tool call details', async () => {
    render(<TrajectoryDrawer sessionId="s1" onClose={() => {}} onSteered={() => {}} />);
    // 先等数据加载完成（findAllByRole 不重试，必须等 Turn 渲染出来）
    await screen.findByText('Turn 1');
    const stepButtons = screen.getAllByRole('button');
    const step2 = stepButtons.find((b) => b.textContent?.includes('Step 2'));
    expect(step2).toBeTruthy();
    fireEvent.click(step2!);
    // 展开后：事件 label「Tool call」+ args JSON 里的 expression
    expect(await screen.findByText('Tool call')).toBeInTheDocument();
    expect(screen.getByText(/expression/)).toBeInTheDocument();
  });

  it('sends a steer message', async () => {
    render(<TrajectoryDrawer sessionId="s1" onClose={() => {}} onSteered={() => {}} />);
    await screen.findByText('Turn 1');
    const input = screen.getByPlaceholderText(/hold off on file changes/);
    fireEvent.change(input, { target: { value: 'stop and summarize' } });
    fireEvent.click(screen.getByText('Steer'));
    await waitFor(() => expect(mockSteer).toHaveBeenCalledWith('s1', 'stop and summarize'));
  });

  it('shows empty state when the log is empty', async () => {
    mockTrajectory.mockResolvedValue({ sessionId: 's1', events: [], turns: [] });
    render(<TrajectoryDrawer sessionId="s1" onClose={() => {}} onSteered={() => {}} />);
    expect(await screen.findByText(/No events yet/)).toBeInTheDocument();
  });
});
