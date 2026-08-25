import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToolApprovalCard } from '../ToolApprovalCard';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const map: Record<string, (p?: Record<string, unknown>) => string> = {
          'chat.approvalPending': ({ toolName }: any) => `⚠️ Tool "${toolName}" requires user approval`,
          'chat.timeout': ({ seconds }: any) => `${seconds}s timeout`,
          'chat.toolRequest': ({ toolName }: any) => `Tool ${toolName} request`,
          'chat.approve': () => '✅ Approve',
          'chat.deny': () => '❌ Deny',
        };
        return map[key]?.(params) ?? key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn(), on: vi.fn(), isInitialized: true },
    }),
  };
});

const pending = {
  toolName: 'write_file',
  args: { path: '/tmp/x', content: 'y' },
  approvalKey: 'k1',
  output: '',
};

describe('ToolApprovalCard', () => {
  it('renders tool name and serialized args', () => {
    render(<ToolApprovalCard pendingApproval={pending} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText(/Tool "write_file" requires user approval/i)).toBeInTheDocument();
    expect(screen.getByText(/"path": "\/tmp\/x"/)).toBeInTheDocument();
  });

  it('calls onApprove with the approval key', () => {
    const onApprove = vi.fn();
    render(<ToolApprovalCard pendingApproval={pending} onApprove={onApprove} onDeny={vi.fn()} />);
    fireEvent.click(screen.getByText(/Approve/i));
    expect(onApprove).toHaveBeenCalledWith('k1');
  });

  it('calls onDeny with the approval key', () => {
    const onDeny = vi.fn();
    render(<ToolApprovalCard pendingApproval={pending} onApprove={vi.fn()} onDeny={onDeny} />);
    fireEvent.click(screen.getByText(/Deny/i));
    expect(onDeny).toHaveBeenCalledWith('k1');
  });
});
