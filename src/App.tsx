import { useState, lazy, Suspense, useCallback } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Sidebar } from './components/Sidebar';
import { AgentChat } from './components/AgentChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Menu, Sparkles, Loader2 } from 'lucide-react';
import type { TabType } from './types';
import { useShortcuts, actionToTab } from './hooks/useShortcuts';

// 非首屏面板按需加载（代码分割：chat 首屏常驻，其余进入对应 Tab 时才拉取 chunk）
const ImageGenerator = lazy(() => import('./components/ImageGenerator').then(m => ({ default: m.ImageGenerator })));
const VideoGenerator = lazy(() => import('./components/VideoGenerator').then(m => ({ default: m.VideoGenerator })));
const ModelManager = lazy(() => import('./components/ModelManager').then(m => ({ default: m.ModelManager })));
const ToolsPanel = lazy(() => import('./components/ToolsPanel').then(m => ({ default: m.ToolsPanel })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const SkillsPanel = lazy(() => import('./components/SkillsPanel').then(m => ({ default: m.SkillsPanel })));
const McpPanel = lazy(() => import('./components/McpPanel').then(m => ({ default: m.McpPanel })));
const ComputerPanel = lazy(() => import('./components/ComputerPanel').then(m => ({ default: m.ComputerPanel })));
const TerminalPanel = lazy(() => import('./components/TerminalPanel').then(m => ({ default: m.TerminalPanel })));
const WorkspacePanel = lazy(() => import('./components/WorkspacePanel').then(m => ({ default: m.WorkspacePanel })));
const TasksPanel = lazy(() => import('./components/TasksPanel').then(m => ({ default: m.TasksPanel })));
const VoicePanel = lazy(() => import('./components/VoicePanel').then(m => ({ default: m.VoicePanel })));
const SystemMonitor = lazy(() => import('./components/SystemMonitor').then(m => ({ default: m.SystemMonitor })));
const GitPanel = lazy(() => import('./components/GitPanel').then(m => ({ default: m.GitPanel })));
const TextTools = lazy(() => import('./components/TextTools').then(m => ({ default: m.TextTools })));
const PluginsPanel = lazy(() => import('./components/PluginsPanel').then(m => ({ default: m.PluginsPanel })));
const MarkdownEditor = lazy(() => import('./components/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));
const ExperimentLab = lazy(() => import('./components/ExperimentLab').then(m => ({ default: m.ExperimentLab })));
const LLMFlameChart = lazy(() => import('./components/LLMFlameChart').then(m => ({ default: m.LLMFlameChart })));
const MemoryPanel = lazy(() => import('./components/MemoryPanel').then(m => ({ default: m.MemoryPanel })));
const MetacogPanel = lazy(() => import('./components/MetacogPanel').then(m => ({ default: m.MetacogPanel })));
const DriftPanel = lazy(() => import('./components/DriftPanel').then(m => ({ default: m.DriftPanel })));

interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  format: 'openai' | 'anthropic';
}

const STORAGE_KEY = 'agent_api_settings';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [apiSettings, setApiSettings] = useLocalStorage<ApiSettings>('agent_api_settings', {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o',
    format: 'openai',
  });
  const [sessionId, setSessionId] = useLocalStorage('agent_api_settings_session', '');

  const handleSessionChange = (id: string) => {
    setSessionId(id);
    localStorage.setItem(STORAGE_KEY + '_session', id);
  };

  // 全局快捷键：动作 → 切换面板
  const handleShortcut = useCallback((action: string) => {
    const tab = actionToTab(action);
    if (tab) setActiveTab(tab);
  }, []);
  useShortcuts(handleShortcut);

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return (
          <AgentChat
            selectedModel={apiSettings.model}
            provider={apiSettings.format}
            providerBaseUrl={apiSettings.baseUrl}
            providerApiKey={apiSettings.apiKey}
            sessionId={sessionId}
            onSessionIdChange={handleSessionChange}
          />
        );
      case 'computer': return <ComputerPanel />;
      case 'terminal': return <TerminalPanel />;
      case 'workspace': return <WorkspacePanel />;
      case 'tasks': return <TasksPanel />;
      case 'skills': return <SkillsPanel />;
      case 'mcp': return <McpPanel />;
      case 'image': return <ImageGenerator />;
      case 'video': return <VideoGenerator />;
      case 'models':
        return <ModelManager onSettingsUpdate={setApiSettings} />;
      case 'tools': return <ToolsPanel sessionId={sessionId} />;
      case 'voice': return <VoicePanel />;
      case 'monitor': return <SystemMonitor />;
      case 'git': return <GitPanel />;
      case 'texttools': return <TextTools />;
      case 'plugins': return <PluginsPanel />;
      case 'markdown': return <MarkdownEditor />;
      case 'experiments': return <ExperimentLab />;
      case 'trace': return <LLMFlameChart />;
      case 'memory': return <MemoryPanel />;
      case 'metacog': return <MetacogPanel />;
      case 'drift': return <DriftPanel />;
      case 'settings': return <Settings onBack={() => setActiveTab('chat')} />;
      default:
        return (
          <AgentChat
            selectedModel={apiSettings.model}
            provider={apiSettings.format}
            providerBaseUrl={apiSettings.baseUrl}
            providerApiKey={apiSettings.apiKey}
            sessionId={sessionId}
            onSessionIdChange={handleSessionChange}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-bg-dark">
      {/* 移动端顶栏 */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 z-40 flex items-center gap-3 px-4 bg-bg-darker border-b border-border">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-hover transition"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-text-primary">AI Agent</span>
        </div>
      </header>

      {/* 移动端抽屉遮罩 */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <main
        className={`transition-all duration-300 h-screen overflow-hidden pt-14 md:pt-0 ${
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-56'
        }`}
      >
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            }
          >
            {renderContent()}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;