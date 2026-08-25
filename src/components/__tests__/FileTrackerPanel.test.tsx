import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FileTrackerPanel, type TrackedFile } from '../FileTrackerPanel';

// Mock i18n — deterministic translations for assertability
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => {
        const map: Record<string, string> = {
          'fileTracker.title':      '文件追踪',
          'fileTracker.clear':      '清除',
          'fileTracker.clearAll':   '清除所有',
          'fileTracker.closePanel': '关闭面板',
          'fileTracker.emptyHint':  'AI 修改文件后<br />将在这里实时显示',
          'fileTracker.new':        '新增',
          'fileTracker.modified':   '已修改',
          'fileTracker.noPreview':  '暂无内容预览',
        };
        return map[key] ?? key;
      },
      i18n: { language: 'zh-CN', changeLanguage: vi.fn(), on: vi.fn(), isInitialized: true },
    }),
  };
});

const files: TrackedFile[] = [
  {
    id: '/tmp/a.ts',
    path: '/tmp/a.ts',
    displayName: 'a.ts',
    operation: 'write',
    lineCount: 12,
    snippet: 'export const a = 1;',
    updatedAt: Date.now(),
  },
  {
    id: '/tmp/b.ts',
    path: '/tmp/b.ts',
    displayName: 'b.ts',
    operation: 'create',
    lineCount: 30,
    snippet: 'export const b = 2;',
    updatedAt: Date.now(),
  },
];

describe('FileTrackerPanel (controlled)', () => {
  it('shows the empty state when there are no files', () => {
    render(<FileTrackerPanel enabled files={[]} expandedId={null} />);
    expect(screen.getByText('文件追踪')).toBeInTheDocument();
    expect(screen.getByText(/AI 修改文件后/)).toBeInTheDocument();
  });

  it('returns null when disabled', () => {
    const { container } = render(<FileTrackerPanel enabled={false} files={files} expandedId={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists tracked files with NEW/MOD badges', () => {
    render(<FileTrackerPanel enabled files={files} expandedId={null} />);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    expect(screen.getByText('已修改')).toBeInTheDocument();
    expect(screen.getByText('新增')).toBeInTheDocument();
  });

  it('expands the file and shows the snippet', () => {
    render(<FileTrackerPanel enabled files={files} expandedId="/tmp/a.ts" />);
    expect(screen.getByText('export const a = 1;')).toBeInTheDocument();
    expect(screen.getByText('/tmp/a.ts')).toBeInTheDocument();
  });

  it('calls onExpand when a collapsed card is clicked', () => {
    const onExpand = vi.fn();
    render(<FileTrackerPanel enabled files={files} expandedId="/tmp/a.ts" onExpand={onExpand} />);
    fireEvent.click(screen.getByText('b.ts'));
    expect(onExpand).toHaveBeenCalledWith('/tmp/b.ts');
  });

  it('calls onClear when 清除 is clicked', () => {
    const onClear = vi.fn();
    render(<FileTrackerPanel enabled files={files} expandedId={null} onClear={onClear} />);
    fireEvent.click(screen.getByText('清除'));
    expect(onClear).toHaveBeenCalled();
  });
});
