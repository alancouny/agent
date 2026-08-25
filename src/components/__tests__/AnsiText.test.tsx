import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnsiText } from '../AnsiText';

describe('AnsiText', () => {
  it('renders plain text without ANSI as a pre', () => {
    render(<AnsiText text="hello world" />);
    const pre = screen.getByText('hello world');
    expect(pre.tagName).toBe('PRE');
  });

  it('renders bold SGR as a bold span', () => {
    render(<AnsiText text={'before \x1b[1mBOLD\x1b[0m after'} />);
    const bold = screen.getByText('BOLD');
    expect(bold.tagName).toBe('SPAN');
    expect(bold.style.fontWeight).toBe('700');
  });

  it('renders a colored SGR as inline color', () => {
    // 31 = red
    render(<AnsiText text={'ok \x1b[31mred\x1b[0m'} />);
    const red = screen.getByText('red');
    expect(red.style.color).toBeTruthy();
  });

  it('supports bright colors (90-97)', () => {
    // 92 = bright green
    render(<AnsiText text={'\x1b[92mgreen\x1b[0m'} />);
    expect(screen.getByText('green').style.color).toBeTruthy();
  });

  it('keeps text outside escape sequences intact', () => {
    const { container } = render(<AnsiText text={'a\x1b[32mb\x1b[0mc'} />);
    expect(container.textContent).toBe('abc');
  });

  it('handles unterminated escape sequence gracefully', () => {
    render(<AnsiText text={'partial \x1b[31mred-only'} />);
    expect(screen.getByText(/partial/)).toBeTruthy();
  });
});
