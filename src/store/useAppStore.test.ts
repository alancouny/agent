import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

describe('useAppStore (D3: frontend state layer)', () => {
  beforeEach(() => {
    // 重置为默认状态，避免用例间串扰
    localStorage.clear();
    useAppStore.setState({
      apiSettings: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o', format: 'openai' },
      sessionId: '',
      activeTab: 'chat',
      sidebarCollapsed: false,
      mobileNavOpen: false,
    });
  });

  it('exposes sensible defaults', () => {
    const s = useAppStore.getState();
    expect(s.apiSettings.model).toBe('gpt-4o');
    expect(s.activeTab).toBe('chat');
    expect(s.sidebarCollapsed).toBe(false);
  });

  it('setApiSettings merges partially (not replace)', () => {
    useAppStore.getState().setApiSettings({ model: 'claude-3' });
    const s = useAppStore.getState();
    expect(s.apiSettings.model).toBe('claude-3');
    // 其余字段保留
    expect(s.apiSettings.baseUrl).toBe('https://api.openai.com/v1');
    expect(s.apiSettings.format).toBe('openai');
  });

  it('setSessionId + setActiveTab + toggleSidebar update state', () => {
    const st = useAppStore.getState();
    st.setSessionId('sess-1');
    st.setActiveTab('tools');
    st.toggleSidebar();
    const s = useAppStore.getState();
    expect(s.sessionId).toBe('sess-1');
    expect(s.activeTab).toBe('tools');
    expect(s.sidebarCollapsed).toBe(true);
  });

  it('persists apiSettings + sessionId to localStorage under the legacy key', () => {
    useAppStore.getState().setApiSettings({ apiKey: 'secret', model: 'gpt-4o-mini' });
    useAppStore.getState().setSessionId('sess-9');
    const raw = localStorage.getItem('agent_api_settings');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    // zustand persist 包裹在 { state, version }
    expect(parsed.state.apiSettings.apiKey).toBe('secret');
    expect(parsed.state.apiSettings.model).toBe('gpt-4o-mini');
    expect(parsed.state.sessionId).toBe('sess-9');
    // UI 状态不应被持久化
    expect(parsed.state.sidebarCollapsed).toBeUndefined();
  });
});
