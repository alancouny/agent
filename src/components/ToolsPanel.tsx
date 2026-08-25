import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wrench,
  Search,
  Calculator,
  FileText,
  Terminal,
  Cloud,
  Clock,
  Cpu,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { logger } from '../utils/logger';
import type { AgentTool } from '../types';
import { agentApi } from '../api/client';

const categoryIcon: Record<string, typeof Wrench> = {
  utility: Calculator,
  search: Search,
  filesystem: FileText,
  development: Terminal,
  tasks: Clock,
  computer: Cpu,
  mcp: Cloud,
};

interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

export function ToolsPanel({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<AgentTool | null>(null);
  const [argsText, setArgsText] = useState('{}');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [categories, setCategories] = useState<string[]>(['all']);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    setIsLoading(true);
    try {
      const list = await agentApi.getTools();
      setTools(list);
      const cats = Array.from(new Set(list.map((t) => t.category)));
      setCategories(['all', ...cats]);
    } catch (error) {
      logger.error('Failed to fetch tools', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (tool: AgentTool) => {
    setSelected(tool);
    const init: Record<string, string> = {};
    for (const k of tool.schema.parameters.required || []) init[k] = '';
    setArgsText(JSON.stringify(init, null, 2));
    setResult(null);
  };

  const handleExecute = async () => {
    if (!selected || isExecuting) return;
    setIsExecuting(true);
    setResult(null);

    let args: Record<string, unknown> = {};
    try {
      args = argsText.trim() ? JSON.parse(argsText) : {};
    } catch {
      setResult({ success: false, output: t('tools.invalidArgs') });
      setIsExecuting(false);
      return;
    }

    try {
      const res = (await agentApi.executeTool(selected.name, args, sessionId)) as ToolResult;
      setResult(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ success: false, output: msg || t('tools.execFailed') });
    } finally {
      setIsExecuting(false);
    }
  };

  const filteredTools = selectedCategory === 'all'
    ? tools
    : tools.filter((t) => t.category === selectedCategory);

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-secondary flex items-center justify-center">
          <Wrench className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('tools.title')}</h2>
          <p className="text-sm text-text-secondary">
            Live registry used by the agent ({tools.length} tools)
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={fetchTools}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary border border-border transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              selectedCategory === category
                ? 'bg-primary text-white'
                : 'bg-bg-card text-text-secondary hover:text-text-primary border border-border'
            }`}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          filteredTools.map((tool) => {
            const IconComponent = categoryIcon[tool.category] || Wrench;
            const isSelected = selected?.name === tool.name;
            return (
              <button
                key={tool.name}
                onClick={() => handleSelect(tool)}
                className={`p-4 rounded-xl text-left transition-all duration-200 ${
                  isSelected
                    ? 'bg-primary border-2 border-primary'
                    : 'bg-bg-card border-2 border-transparent hover:border-primary/30'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                    isSelected ? 'bg-white/20' : 'bg-bg-hover'
                  }`}
                >
                  <IconComponent
                    className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-text-secondary'}`}
                  />
                </div>
                <h3 className={`font-medium mb-1 ${isSelected ? 'text-white' : 'text-text-primary'}`}>
                  {tool.name}
                </h3>
                <p className={`text-sm ${isSelected ? 'text-white/70' : 'text-text-secondary'}`}>
                  {tool.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-bg-hover text-text-secondary'
                    }`}
                  >
                    {tool.category}
                  </span>
                  {tool.requiresApproval && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> approval
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {selected && (
        <div className="mt-6 pt-6 border-t border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-medium text-text-primary">{selected.name}</h3>
              <p className="text-xs text-text-secondary">{selected.description}</p>
            </div>
            <button
              onClick={handleExecute}
              disabled={isExecuting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Execute
                </>
              )}
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1">
              Arguments (JSON){' '}
              {(selected.schema.parameters.required || []).length > 0 && (
                <span className="text-amber-400">
                  required: {selected.schema.parameters.required.join(', ')}
                </span>
              )}
            </label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full px-3 py-2 bg-bg-card border border-border rounded-lg text-text-primary font-mono text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {isExecuting ? (
            <div className="bg-bg-card rounded-xl p-4 flex items-center justify-center">
              <RefreshCw className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : result ? (
            <div
              className={`rounded-xl p-4 border ${
                result.success
                  ? 'bg-success/10 border-success/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}
            >
              {result.error === 'PENDING_APPROVAL' ? (
                <p className="text-sm text-amber-400">
                  This tool requires approval. Enable "skip approval" in Settings, or approve
                  it from the agent chat when invoked there.
                </p>
              ) : (
                <pre className="text-sm text-text-primary whitespace-pre-wrap break-words">
                  {result.output || '(no output)'}
                </pre>
              )}
            </div>
          ) : (
            <div className="bg-bg-card rounded-xl p-8 text-center text-text-secondary">
              <Wrench className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Edit the arguments and click Execute to run {selected.name}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
