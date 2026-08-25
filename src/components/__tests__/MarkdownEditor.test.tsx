import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownEditor } from '../MarkdownEditor';

// markdown-it 渲染为真实 HTML；不 mock 保留预览断言
describe('MarkdownEditor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders starter markdown in preview mode', () => {
    render(<MarkdownEditor />);
    fireEvent.click(screen.getByText('preview'));
    // 起始模板包含 "# Geek Markdown"
    expect(screen.getByRole('heading', { name: 'Geek Markdown' })).toBeTruthy();
  });

  it('updates preview live as the source changes', () => {
    render(<MarkdownEditor />);
    fireEvent.click(screen.getByText('split'));
    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: '# Live Title\n\n**bold text**' } });
    expect(screen.getByRole('heading', { name: 'Live Title' })).toBeTruthy();
    expect(screen.getByText('bold text')).toBeTruthy();
  });

  it('persists the draft to localStorage', () => {
    render(<MarkdownEditor />);
    fireEvent.click(screen.getByText('edit'));
    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: '# Draft\n' } });
    expect(localStorage.getItem('md_editor_draft')).toContain('# Draft');
  });

  it('escape-escapes raw HTML (html:false)', () => {
    render(<MarkdownEditor />);
    fireEvent.click(screen.getByText('split'));
    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: '<script>alert(1)</script>' } });
    // markdown-it html:false → 不产生真实 script 元素；文本以转义形式出现
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getAllByText(/<script>/).length).toBeGreaterThan(0);
  });
});
