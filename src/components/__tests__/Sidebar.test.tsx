import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Sidebar } from '../Sidebar';

describe('Sidebar', () => {
  it('renders all navigation items including Voice', () => {
    render(<Sidebar activeTab="chat" onTabChange={() => {}} collapsed={false} onToggleCollapse={() => {}} />);
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('calls onTabChange when an item is clicked', () => {
    const onChange = vi.fn();
    render(<Sidebar activeTab="chat" onTabChange={onChange} collapsed={false} onToggleCollapse={() => {}} />);
    fireEvent.click(screen.getByText('Voice'));
    expect(onChange).toHaveBeenCalledWith('voice');
    fireEvent.click(screen.getByText('Settings'));
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('hides labels when collapsed', () => {
    render(<Sidebar activeTab="chat" onTabChange={() => {}} collapsed onToggleCollapse={() => {}} />);
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});
