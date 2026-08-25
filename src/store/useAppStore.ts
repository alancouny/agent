/**
 * 前端全局状态层（🏗️ 深度重构档 · D3）
 *
 * 统一收敛原先散落在 App / ModelManager / ExperimentLab / WorkspacePanel 的
 * useLocalStorage('agent_api_settings') 与 useState 散点状态，改为单一 zustand store。
 * 通过 persist 中间件持久化 apiSettings + sessionId（与历史 localStorage key 同名），
 * 其余（activeTab / 侧栏 / 移动端抽屉）为会话内 UI 状态，不持久化。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ApiSettings, TabType } from '../types';

interface AppState {
  /** LLM provider 配置（模型 / 地址 / 密钥 / 格式），chat 请求体透传。 */
  apiSettings: ApiSettings;
  /** 当前会话 id。 */
  sessionId: string;
  /** 当前激活的面板 Tab。 */
  activeTab: TabType;
  /** 侧栏是否收起。 */
  sidebarCollapsed: boolean;
  /** 移动端导航抽屉是否打开。 */
  mobileNavOpen: boolean;

  setApiSettings: (partial: Partial<ApiSettings>) => void;
  setSessionId: (id: string) => void;
  setActiveTab: (tab: TabType) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
}

const DEFAULT_API_SETTINGS: ApiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  format: 'openai',
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      apiSettings: DEFAULT_API_SETTINGS,
      sessionId: '',
      activeTab: 'chat',
      sidebarCollapsed: false,
      mobileNavOpen: false,

      setApiSettings: (partial) =>
        set((s) => ({ apiSettings: { ...s.apiSettings, ...partial } })),
      setSessionId: (id) => set({ sessionId: id }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
    }),
    {
      name: 'agent_api_settings',
      storage: createJSONStorage(() => localStorage),
      // 仅持久化业务数据；UI 状态每次会话重新初始化
      partialize: (s) => ({ apiSettings: s.apiSettings, sessionId: s.sessionId }),
    }
  )
);
