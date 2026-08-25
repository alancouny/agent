import { useState, useRef, useEffect, useCallback } from 'react';
import { apiUrl } from '../apiConfig';
import { useTranslation } from 'react-i18next';
import {
  Terminal as TerminalIcon,
  Send,
  Trash2,
  Copy,
  Loader2,
  XCircle,
  CheckCircle2,
} from 'lucide-react';
import { AnsiText } from './AnsiText';
import { systemApi, apiFetch } from '../api/client';

interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  success: boolean;
  timestamp: string;
}

// ── 内置极客命令：不经过后端，本地即时响应 ──
type BuiltinFn = (args: string[], ctx: { clear: () => void }) => { ok: boolean; output: string } | Promise<{ ok: boolean; output: string }>;

const BUILTINS: Record<string, BuiltinFn> = {
  help: () => ({
    ok: true,
    output: [
      'Built-in commands (instant, no backend):',
      '  help         this list',
      '  clear        clear the screen',
      '  echo <text>  print text',
      '  date         current date/time',
      '  sysinfo      CPU / memory / network snapshot',
      '  fortune      random geek quote',
      '  alias        list built-in aliases',
      'Anything else is executed on the backend (zsh).',
      'Tip: ↑/↓ history · Tab autocomplete · plugins via <plugin>.<cmd>',
    ].join('\n'),
  }),
  clear: (_a, { clear }) => {
    clear();
    return { ok: true, output: '' };
  },
  echo: (a) => ({ ok: true, output: a.join(' ') }),
  date: () => ({ ok: true, output: new Date().toString() }),
  alias: () => ({
    ok: true,
    output: Object.keys(BUILTINS).join('\n'),
  }),
  sysinfo: async () => {
    try {
      const s = await systemApi.stats();
      const fmt = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);
      return {
        ok: true,
        output: [
          `host    ${s.hostname} (${s.platform})`,
          `cpu     ${s.cpu.usage === null ? 'collecting…' : `${s.cpu.usage.toFixed(1)}%`} · ${s.cpu.cores} cores · load ${s.cpu.loadAvg.map((l) => l.toFixed(2)).join(' ')}`,
          `mem     ${fmt(s.memory.used)} / ${fmt(s.memory.total)} (${s.memory.percent}%)`,
          `net     ↓ ${s.net ? fmt(s.net.rxRate) + '/s' : 'n/a'}  ↑ ${s.net ? fmt(s.net.txRate) + '/s' : 'n/a'}`,
          `uptime  ${Math.floor(s.uptime / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m`,
        ].join('\n'),
      };
    } catch {
      return { ok: false, output: 'sysinfo: backend unreachable' };
    }
  },
  fortune: () => {
    const quotes = [
      'Premature optimization is the root of all evil.',
      'Simplicity is the soul of efficiency.',
      'Debugging is twice as hard as writing the code.',
      'There are only two hard things: cache invalidation and naming.',
      'First, solve the problem. Then, write the code.',
    ];
    return { ok: true, output: `"${quotes[Math.floor(Math.random() * quotes.length)]}"` };
  },
};

const PLUGIN_HINTS = ['geek-demo.fortune', 'geek-demo.fib', 'geek-demo.ascii', 'geek-demo.cointoss'];

export function TerminalPanel() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [copyId, setCopyId] = useState<string | null>(null);
  // 已执行命令历史（↑↓ 遍历）与当前遍历下标
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const histIdxRef = useRef(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || isRunning) return;

    const id = `${Date.now()}-${Math.random()}`;
    setHistory(prev => [...prev, {
      id,
      command: cmd,
      output: '',
      success: true,
      timestamp: new Date().toISOString(),
    }]);
    // 记录历史（供 ↑↓ 遍历）
    setCmdHistory(prev => (prev[prev.length - 1] === cmd ? prev : [...prev, cmd]));
    setIsRunning(true);

    // 内置命令：本地即时响应
    const [name, ...args] = cmd.trim().split(/\s+/);
    const builtin = BUILTINS[name];
    if (builtin) {
      try {
        const r = await builtin(args, { clear: clearHistory });
        setHistory(prev =>
          prev.map(e => e.id === id ? { ...e, output: r.output, success: r.ok, timestamp: new Date().toISOString() } : e)
        );
      } finally {
        setIsRunning(false);
      }
      return;
    }

    try {
      const res = await apiFetch(apiUrl('/api/terminal/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, cwd }),
      });
      const data = await res.json();
      setHistory(prev =>
        prev.map(e => e.id === id ? {
          ...e,
          output: data.output,
          success: data.success,
          timestamp: data.timestamp || e.timestamp,
        } : e)
      );
      if (data.cwd) setCwd(data.cwd);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('terminal.connFailed');
      setHistory(prev =>
        prev.map(e => e.id === id ? {
          ...e,
          output: `Error: ${message}`,
          success: false,
        } : e)
      );
    } finally {
      setIsRunning(false);
    }
  }, [cwd, isRunning, t]);

  const handleSend = () => {
    executeCommand(input);
    setInput('');
    histIdxRef.current = -1;
  };

  // ↑↓ 历史遍历 / Tab 自动补全
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      histIdxRef.current = Math.min(histIdxRef.current + 1, cmdHistory.length - 1);
      setInput(cmdHistory[cmdHistory.length - 1 - histIdxRef.current]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdxRef.current <= 0) {
        histIdxRef.current = -1;
        setInput('');
      } else {
        histIdxRef.current -= 1;
        setInput(cmdHistory[cmdHistory.length - 1 - histIdxRef.current]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const prefix = input.trim().toLowerCase();
      if (!prefix) return;
      const candidates = [
        ...Object.keys(BUILTINS),
        ...PLUGIN_HINTS,
        ...cmdHistory.filter((c) => c.toLowerCase().startsWith(prefix)).map((c) => c.split(/\s+/)[0]),
      ].filter((v, i, arr) => arr.indexOf(v) === i);
      const hit = candidates.find((c) => c.toLowerCase().startsWith(prefix));
      if (hit) setInput(hit + ' ');
    }
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyId(id);
      setTimeout(() => setCopyId(null), 1500);
    } catch { /* ignore */ }
  };

  const clearHistory = () => {
    setHistory([]);
  };

  return (
    <div className="flex flex-col h-screen bg-bg-darker">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-card/50">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-text-primary">{t('terminal.title')}</span>
          <div className="flex items-center gap-1.5 ml-3">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>
          {cwd && (
            <span className="ml-3 text-[10px] text-text-muted font-mono bg-bg-dark px-2 py-0.5 rounded">
              {cwd}
            </span>
          )}
        </div>
        <button
          onClick={clearHistory}
          className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition"
          title="Clear history"
        >
          <Trash2 className="w-3 h-3" />
          Clear
        </button>
      </div>

      {/* Output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        <div className="text-text-muted text-[10px] mb-2">
          <span>zsh</span> <span className="ml-1 opacity-60">— shared session with terminal.execute</span>
        </div>

        {history.map((entry) => (
          <div key={entry.id} className="mb-3 group">
            <div className="flex items-center gap-2">
              <span className="text-primary">$</span>
              <span className="text-text-primary">{entry.command}</span>
              <span className="text-[9px] text-text-muted ml-auto">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {entry.output && (
              <div className="ml-4 mt-1 relative group/output">
                <div className={`text-[11px] leading-relaxed ${entry.success ? '' : ''}`}>
                  <AnsiText text={entry.output} className={`text-[11px] leading-relaxed ${entry.success ? 'text-text-secondary' : 'text-red-400'}`} />
                </div>
                <div className="absolute top-0 right-0 opacity-0 group-hover/output:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCopy(entry.output, entry.id)}
                    className="p-1 bg-bg-card border border-border rounded text-text-muted hover:text-text-primary transition"
                  >
                    {copyId === entry.id ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {!entry.output && (
              <div className="ml-4 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin text-text-muted" />
                <span className="text-text-muted text-[10px]">{t('terminal.running')}</span>
              </div>
            )}

            {!entry.success && entry.output && (
              <div className="ml-4 flex items-center gap-1 mt-1">
                <XCircle className="w-3 h-3 text-red-400" />
                <span className="text-red-400 text-[10px]">exit 1</span>
              </div>
            )}
          </div>
        ))}

        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
            <TerminalIcon className="w-12 h-12 text-text-muted mb-3" />
            <p className="text-text-muted text-xs">{t('terminal.empty')}</p>
            <p className="text-text-muted text-[10px] mt-1 max-w-xs">
              Type a command below and press Enter. Commands run in zsh with the same sandbox as terminal.execute.
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-bg-card/50 p-3">
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-mono">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('terminal.commandPlaceholder')}
            disabled={isRunning}
            className="flex-1 bg-transparent border-0 text-sm font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isRunning}
            className="p-1.5 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}