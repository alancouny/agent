import { useState } from 'react';
import {
  Settings as SettingsIcon,
  Palette,
  BookOpen,
  FileText,
  Languages,
  Keyboard,
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RagHelp } from './RagHelp';
import { ThemeSection } from './settings/ThemeSection';
import { LanguageSection } from './settings/LanguageSection';
import { GeneralSection } from './settings/GeneralSection';
import { KnowledgeSection } from './settings/KnowledgeSection';
import { PromptsSection } from './settings/PromptsSection';
import { ShortcutsSection } from './settings/ShortcutsSection';

type SettingsSection = 'theme' | 'language' | 'general' | 'knowledge' | 'prompts' | 'shortcuts';

export function Settings({ onBack }: { onBack?: () => void }) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('theme');
  const { t } = useTranslation();
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const sections = [
    { id: 'knowledge' as SettingsSection, icon: BookOpen, label: t('settings.sections.knowledge') },
    { id: 'prompts' as SettingsSection, icon: FileText, label: t('settings.sections.prompts') },
    { id: 'theme' as SettingsSection, icon: Palette, label: t('settings.sections.theme') },
    { id: 'language' as SettingsSection, icon: Languages, label: t('settings.sections.language') },
    { id: 'shortcuts' as SettingsSection, icon: Keyboard, label: t('settings.sections.shortcuts') },
    { id: 'general' as SettingsSection, icon: SettingsIcon, label: t('settings.sections.general') },
  ];

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'language':
        return <LanguageSection />;
      case 'knowledge':
        return (
          <>
            <KnowledgeSection onNotify={showNotification} />
            <RagHelp />
          </>
        );
      case 'prompts':
        return <PromptsSection onNotify={showNotification} />;
      case 'theme':
        return <ThemeSection />;
      case 'shortcuts':
        return <ShortcutsSection />;
      case 'general':
        return <GeneralSection onNotify={showNotification} />;
      default:
        return <ThemeSection />;
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      {notification && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg ${
          notification.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {notification.message}
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <div className="flex-1" />
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition"
            >
              <ChevronLeft className="w-4 h-4" /> 返回
            </button>
          )}
        </div>

        <div className="flex gap-6">
          <nav className="w-64 flex-shrink-0">
            <div className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    activeSection === section.id
                      ? 'bg-primary text-white'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <section.icon className="w-5 h-5" />
                  <span className="font-medium">{section.label}</span>
                  <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${
                    activeSection === section.id ? 'rotate-90' : ''
                  }`} />
                </button>
              ))}
            </div>
          </nav>

          <div className="flex-1">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
