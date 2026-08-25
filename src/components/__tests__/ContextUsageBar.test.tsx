import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ContextUsageBar } from '../ContextUsageBar';
import type { ContextUsage } from '../../types';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => {
        const map: Record<string, string> = {
          'contextUsage.title': '上下文窗口使用情况',
          'contextUsage.titleDetail': '上下文窗口使用情况（点击查看详情）',
          'contextUsage.label': '上下文',
          'contextUsage.windowTitle': '上下文窗口使用情况',
          'contextUsage.model': '模型',
          'contextUsage.currentContext': '当前上下文',
          'contextUsage.inputPrompt': '输入（prompt）',
          'contextUsage.outputCompletion': '输出（completion）',
          'contextUsage.windowSize': '窗口容量',
          'contextUsage.unknown': '未知',
          'contextUsage.usageRate': '利用率',
          'contextUsage.sessionCumulative': '会话累计',
          'contextUsage.dataSource': '数据来源',
          'contextUsage.source.live': '实时',
          'contextUsage.source.restored': '已恢复',
          'contextUsage.source.estimated': '估算值',
          'contextUsage.source.none': '—',
          'contextUsage.compressedTitle': 'Context has been compressed',
          'contextUsage.compressedBadge': 'COMPRESSED',
          'contextUsage.compressedLabel': 'Compression',
          'contextUsage.compressedActive': 'Active',
        };
        return map[key] ?? key;
      },
      i18n: { language: 'zh-CN', changeLanguage: vi.fn(), on: vi.fn(), isInitialized: true },
    }),
  };
});

const usage: ContextUsage = {
  contextUsed: 12_400,
  contextPrompt: 9_000,
  contextCompletion: 3_400,
  contextWindow: 128_000,
  percent: 9.7,
  cumulative: { total: 42_000, prompt: 30_000, completion: 12_000 },
  source: 'live',
};

describe('ContextUsageBar', () => {
  it('shows a placeholder when there is no data', () => {
    render(<ContextUsageBar usage={null} model="gpt-4o" streaming={false} />);
    expect(screen.getByText(/上下文 --/)).toBeInTheDocument();
  });

  it('shows the ellipsis placeholder while streaming with no data yet', () => {
    render(<ContextUsageBar usage={null} model="gpt-4o" streaming />);
    expect(screen.getByText(/上下文/)).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('renders used/window tokens and the percent', () => {
    render(<ContextUsageBar usage={usage} model="gpt-4o" streaming={false} />);
    expect(screen.getByText(/12\.4k/)).toBeInTheDocument();
    expect(screen.getByText(/128\.0k/)).toBeInTheDocument();
    expect(screen.getByText(/9\.7%/)).toBeInTheDocument();
  });

  it('expands details on click (prompt / completion / cumulative / source)', () => {
    render(<ContextUsageBar usage={usage} model="gpt-4o" streaming={false} />);
    fireEvent.click(screen.getByTitle('上下文窗口使用情况（点击查看详情）'));

    expect(screen.getByText('当前上下文')).toBeInTheDocument();
    expect(screen.getByText('12,400 tokens')).toBeInTheDocument();
    expect(screen.getByText('9,000')).toBeInTheDocument(); // prompt
    expect(screen.getByText('3,400')).toBeInTheDocument(); // completion
    expect(screen.getByText('窗口容量')).toBeInTheDocument();
    expect(screen.getByText('128,000')).toBeInTheDocument();
    expect(screen.getByText('会话累计')).toBeInTheDocument();
    expect(screen.getByText('42,000 tokens')).toBeInTheDocument();
    expect(screen.getByText('实时')).toBeInTheDocument();
  });

  it('marks danger level when usage exceeds 80%', () => {
    render(
      <ContextUsageBar
        usage={{ ...usage, percent: 85, contextUsed: 108_800 }}
        model="gpt-4o"
        streaming={false}
      />
    );
    expect(screen.getByText(/85\.0%/)).toBeInTheDocument();
  });
});
