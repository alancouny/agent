import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Play, FileCode, RefreshCw, Copy, Check, Bug, Sparkles } from 'lucide-react';
import { codeApi } from '../api/client';
import { logger } from '../utils/logger';

type CodeToolType = 'analyze' | 'generate' | 'refactor';

export function CodeTools() {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<CodeToolType>('analyze');
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('python');
  const [framework, setFramework] = useState('');
  const [improvements, setImprovements] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);

  const languages = [
    'python',
    'javascript',
    'typescript',
    'java',
    'cpp',
    'go',
    'rust',
    'swift',
    'kotlin',
    'ruby',
    'php',
    'csharp',
  ];

  const frameworks: Record<string, string[]> = {
    python: ['django', 'flask', 'fastapi', 'pandas', 'numpy', 'tensorflow', 'pytorch'],
    javascript: ['react', 'vue', 'angular', 'node', 'express', 'nextjs', 'nestjs'],
    typescript: ['react', 'vue', 'angular', 'node', 'express', 'nextjs', 'nestjs'],
    java: ['spring', 'hibernate', 'javafx', 'quarkus'],
    go: ['gin', 'echo', 'fiber', 'grpc'],
    rust: ['actix', 'rocket', 'tokio', 'hyper'],
  };

  const handleAnalyze = async () => {
    if (!code.trim() || isLoading) return;

    setIsLoading(true);

    try {
      const response = await codeApi.analyze({
        code,
        language,
      });

      if (response.analysis) {
        setResult(response.analysis);
      }
    } catch (error) {
      logger.error(t('code.analyzeError'), error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);

    try {
      const response = await codeApi.generate(prompt, language, framework);

      if (response.code) {
        setResult(response.code);
      }
    } catch (error) {
      logger.error(t('code.generateError'), error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefactor = async () => {
    if (!code.trim() || isLoading) return;

    setIsLoading(true);

    try {
      const response = await codeApi.refactor(code, language, improvements);

      if (response.refactored_code) {
        setResult(response.refactored_code);
      }
    } catch (error) {
      logger.error(t('code.refactorError'), error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tools: { id: CodeToolType; icon: typeof Code; label: string; description: string }[] = [
    { id: 'analyze', icon: Bug, label: 'Analyze', description: t('code.analyzeDesc') },
    { id: 'generate', icon: Sparkles, label: 'Generate', description: t('code.generateDesc') },
    { id: 'refactor', icon: RefreshCw, label: 'Refactor', description: t('code.refactorDesc') },
  ];

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
          <Code className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('code.title')}</h2>
          <p className="text-sm text-text-secondary">{t('code.subtitle')}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              setActiveTool(tool.id);
              setResult('');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
              activeTool === tool.id
                ? 'bg-primary text-white'
                : 'bg-bg-card text-text-secondary hover:text-text-primary border border-border'
            }`}
          >
            <tool.icon className="w-4 h-4" />
            {tool.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">
        <div className="flex flex-col space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Language
              </label>
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setFramework('');
                }}
                className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary transition-colors"
              >
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang.charAt(0).toUpperCase() + lang.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            {(activeTool === 'generate') && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Framework
                </label>
                <select
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">{t('common.none')}</option>
                  {(frameworks[language] || []).map((fw) => (
                    <option key={fw} value={fw}>
                      {fw.charAt(0).toUpperCase() + fw.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {activeTool === 'generate' ? (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Code Description
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('code.analyzePh')}
                className="w-full h-40 px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-primary transition-colors font-mono text-sm"
                disabled={isLoading}
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Code Input
                </label>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('code.pasteCodePh')}
                  className="w-full h-40 px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-primary transition-colors font-mono text-sm"
                  disabled={isLoading}
                />
              </div>
              {activeTool === 'refactor' && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Improvements
                  </label>
                  <input
                    type="text"
                    value={improvements}
                    onChange={(e) => setImprovements(e.target.value)}
                    placeholder={t('code.improvePh')}
                    className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              )}
            </>
          )}

          <button
            onClick={() => {
              if (activeTool === 'analyze') handleAnalyze();
              else if (activeTool === 'generate') handleGenerate();
              else if (activeTool === 'refactor') handleRefactor();
            }}
            disabled={
              isLoading ||
              (activeTool === 'analyze' && !code.trim()) ||
              (activeTool === 'generate' && !prompt.trim()) ||
              (activeTool === 'refactor' && !code.trim())
            }
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-primary/25"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                {activeTool === 'analyze' && 'Analyze Code'}
                {activeTool === 'generate' && 'Generate Code'}
                {activeTool === 'refactor' && 'Refactor Code'}
              </>
            )}
          </button>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileCode className="w-5 h-5 text-text-secondary" />
              <span className="font-medium text-text-primary">{t('common.result')}</span>
            </div>
            <button
              onClick={handleCopy}
              disabled={!result}
              className="flex items-center gap-1 px-3 py-1.5 bg-bg-card border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-success" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
          </div>

          <div className="flex-1 bg-bg-card border border-border rounded-xl overflow-hidden">
            {result ? (
              <pre className="h-full overflow-auto p-4 text-sm font-mono text-text-primary whitespace-pre-wrap">
                {result}
              </pre>
            ) : (
              <div className="h-full flex items-center justify-center text-text-secondary">
                <div className="text-center">
                  <Code className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">{t('code.placeholder')}</p>
                  <p className="text-xs mt-1">
                    {activeTool === 'analyze' && t('code.analyzePh')}
                    {activeTool === 'generate' && 'Enter description and click Generate'}
                    {activeTool === 'refactor' && 'Enter code and click Refactor'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
