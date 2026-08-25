import { useEffect, useRef, useState} from 'react';
import { useTranslation} from 'react-i18next';
import { HelpCircle, X, ChevronDown, ChevronRight} from 'lucide-react';

type Tab = 'intro' | 'notes' | 'qa';

const TABS: { id: Tab; label: string }[] = [
  { id: 'intro', label: 'ragHelp.tabIntro' },
  { id: 'notes', label: 'ragHelp.tabNotes' },
  { id: 'qa', label: 'ragHelp.tabQa' },
];

const NOTES_KEYS = [
  'ragHelp.note0',
  'ragHelp.note1',
  'ragHelp.note2',
  'ragHelp.note3',
  'ragHelp.note4',
  'ragHelp.note5',
  'ragHelp.note6',
];

const QA_KEYS = [
  'ragHelp.qa0',
  'ragHelp.qa1',
  'ragHelp.qa2',
  'ragHelp.qa3',
  'ragHelp.qa4',
  'ragHelp.qa5',
  'ragHelp.qa6',
  'ragHelp.qa7',
  'ragHelp.qa8',
  'ragHelp.qa9',
];

export function RagHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('intro');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset expanded state when switching tabs
  useEffect(() => setExpanded({}), [tab, open]);

  return (
    <>
      {/* Floating ? button, bottom-right of the Knowledge section */}
      <button
        onClick={() => setOpen(true)}
        title={t('ragHelp.tooltip')}
        className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover transition-colors flex items-center justify-center"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col bg-bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold text-text-primary">{t('ragHelp.title')}</h3>
                <p className="text-xs text-text-muted mt-0.5">{t('ragHelp.subtitle')}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1 px-4 pt-3 border-b border-border">
              {TABS.map((tabItem) => (
                <button
                  key={tabItem.id}
                  onClick={() => setTab(tabItem.id)}
                  className={`px-3 py-2 text-sm rounded-t-lg transition-colors ${
                    tab === tabItem.id
                      ? 'bg-bg-input text-text-primary border-b-2 border-primary font-medium'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t(tabItem.label)}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {tab === 'intro' && (
                <div className="space-y-3 text-sm text-text-secondary leading-relaxed">
                  <p>
                    {t('ragHelp.introText')}
                    <strong className="text-text-primary">{t('ragHelp.localFirstLabel')}</strong>：{t('ragHelp.localFirstBody')}
                  </p>
                  <div className="bg-bg-input/60 rounded-lg p-3 font-mono text-xs leading-relaxed">
                    <div>{t('ragHelp.pipeline1')}</div>
                    <div className="opacity-60">↓</div>
                    <div>{t('ragHelp.pipeline2')}</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      [t('ragHelp.kvEmbedding'), t('ragHelp.descEmbedding')],
                      [t('ragHelp.kvChunk'), t('ragHelp.descChunk')],
                      [t('ragHelp.kvStrategy'), t('ragHelp.descStrategy')],
                      [t('ragHelp.kvRetrieval'), t('ragHelp.descRetrieval')],
                      [t('ragHelp.kvRerank'), t('ragHelp.descRerank')],
                      [t('ragHelp.kvTopK'), t('ragHelp.descTopK')],
                      [t('ragHelp.kvBackend'), t('ragHelp.descBackend')],
                    ].map(([k, v]) => (
                      <div key={k} className="bg-bg-input/40 rounded-lg px-3 py-2">
                        <div className="text-text-primary font-medium text-xs">{k}</div>
                        <div className="text-xs mt-0.5">{v}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">
                    {t('ragHelp.fullDoc')}
                  </p>
                </div>
              )}

              {tab === 'notes' && (
                <div className="space-y-2">
                  {NOTES_KEYS.map((key, i) => {
                    // 翻译键存的是 JSON 字符串——解析失败时兜底展示键名，避免白屏
                    let note: { title: string; body: string } | null = null;
                    try {
                      note = JSON.parse(t(key));
                    } catch { /* keep null */ }
                    return (
                      <div key={i} className="border border-border rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-bg-input/50 transition-colors"
                        >
                          <span className="text-sm font-medium text-text-primary">{note?.title ?? t(key)}</span>
                          {expanded[i] ? (
                            <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
                          )}
                        </button>
                        {expanded[i] && (
                          <div className="px-3 pb-3 text-sm text-text-secondary leading-relaxed">{note?.body ?? ''}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === 'qa' && (
                <div className="space-y-2">
                  {QA_KEYS.map((key, i) => {
                    let item: { q: string; a: string } | null = null;
                    try {
                      item = JSON.parse(t(key));
                    } catch { /* keep null */ }
                    return (
                      <div key={i} className="border border-border rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-bg-input/50 transition-colors"
                        >
                          <span className="text-sm font-medium text-text-primary">Q{i + 1} · {item?.q ?? t(key)}</span>
                          {expanded[i] ? (
                            <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
                          )}
                        </button>
                        {expanded[i] && (
                          <div className="px-3 pb-3 text-sm text-text-secondary leading-relaxed">{item?.a ?? ''}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
