import {
  MessageSquare,
  ListTodo,
  Image,
  Video,
  Cpu,
  Wrench,
  Settings,
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Plug,
  BookOpen,
  Monitor,
  Terminal as TerminalIcon,
  FolderOpen,
  Activity,
  GitBranch,
  Replace,
  Blocks,
  FileText,
  FlaskConical,
  BarChart3,
  Brain,
  BrainCircuit,
  Radar,
} from 'lucide-react';
import type { TabType } from '../types';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 移动端抽屉状态：true 显示（桌面端忽略） */
  mobileOpen?: boolean;
  /** 移动端选中导航后关闭抽屉 */
  onMobileClose?: () => void;
}

const navItemDefs: { id: TabType; icon: typeof MessageSquare; key: string }[] = [
  { id: 'chat', icon: MessageSquare, key: 'nav.chat' },
  { id: 'tasks', icon: ListTodo, key: 'nav.tasks' },
  { id: 'computer', icon: Monitor, key: 'nav.computer' },
  { id: 'terminal', icon: TerminalIcon, key: 'nav.terminal' },
  { id: 'workspace', icon: FolderOpen, key: 'nav.workspace' },
  { id: 'skills', icon: BookOpen, key: 'nav.skills' },
  { id: 'image', icon: Image, key: 'nav.image' },
  { id: 'video', icon: Video, key: 'nav.video' },
  { id: 'mcp', icon: Plug, key: 'nav.mcp' },
  { id: 'models', icon: Cpu, key: 'nav.models' },
  { id: 'tools', icon: Wrench, key: 'nav.tools' },
  { id: 'voice', icon: AudioLines, key: 'nav.voice' },
  // ── 极客功能模块 ──
  { id: 'monitor', icon: Activity, key: 'nav.monitor' },
  { id: 'git', icon: GitBranch, key: 'nav.git' },
  { id: 'texttools', icon: Replace, key: 'nav.texttools' },
  { id: 'plugins', icon: Blocks, key: 'nav.plugins' },
  { id: 'markdown', icon: FileText, key: 'nav.markdown' },
  { id: 'experiments', icon: FlaskConical, key: 'nav.experiments' },
  { id: 'trace', icon: BarChart3, key: 'nav.trace' },
  { id: 'memory', icon: Brain, key: 'nav.memory' },
  { id: 'metacog', icon: BrainCircuit, key: 'nav.metacog' },
  { id: 'drift', icon: Radar, key: 'nav.drift' },
  { id: 'settings', icon: Settings, key: 'nav.settings' },
];

export function Sidebar({ activeTab, onTabChange, collapsed, onToggleCollapse, mobileOpen = false, onMobileClose }: SidebarProps) {
  const { t } = useTranslation();
  const navItems = useMemo(() => navItemDefs.map((d) => ({ ...d, label: t(d.key) })), [t]);
  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-bg-darker border-r border-border flex flex-col transition-all duration-300 z-50 ${
        collapsed ? 'w-16' : 'w-56'
      } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
    >
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-lg font-bold text-text-primary whitespace-nowrap">
                AI Agent
              </h1>
              <p className="text-xs text-text-secondary whitespace-nowrap">
                {t('nav.subtitle')}
              </p>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => { onTabChange(item.id); onMobileClose?.(); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
              activeTab === item.id
                ? 'bg-primary text-white shadow-lg shadow-primary/25'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && (
              <span className="font-medium whitespace-nowrap text-sm">
                {item.label}
              </span>
            )}
            {activeTab === item.id && !collapsed && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />
            )}
          </button>
        ))}
      </nav>

      <button
        onClick={onToggleCollapse}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-bg-card border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-primary transition-all duration-200 shadow-lg"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>
    </aside>
  );
}