import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Eye, Code2, Download, FileDown, Trash2, Sparkles } from 'lucide-react';
import MarkdownIt from 'markdown-it';

// 极客风格 Markdown 渲染：代码高亮感、表格、任务列表
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: (code, lang) => {
    const cls = lang ? `language-${lang}` : '';
    return `<pre class="geek-code ${cls}"><code>${escapeHtml(code)}</code></pre>`;
  },
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STARTER = `# Geek Markdown\n\n> Write **live**, export **hard**.  \n> 写在这里，实时预览，一键导出。\n\n## Features\n\n- [x] Real-time preview\n- [x] Export HTML\n- [x] Export PDF (print)\n- [ ] Your idea here\n\n\\\`\\\`\\\`ts\nconst geek = (x: number) => x * 0x2a;\nconsole.log(geek(21)); // 882\n\\\`\\\`\\\`\n\n| key | value |\n| --- | ----- |\n| vibe | **max** |\n| deps | ~zero |\n\n---\n\nMade with ❤ and zero heavy deps.\n`;

export function MarkdownEditor() {
  const { t } = useTranslation();
  const [src, setSrc] = useState(() => {
    try { return localStorage.getItem('md_editor_draft') || STARTER; } catch { return STARTER; }
  });
  const [mode, setMode] = useState<'split' | 'preview' | 'edit'>('split');
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem('md_editor_draft', src); } catch { /* ignore */ }
  }, [src]);

  const html = useMemo(() => md.render(src), [src]);

  const exportHtml = () => {
    const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Markdown Export</title>
<style>
  body { max-width: 780px; margin: 2rem auto; padding: 0 1.5rem;
    font: 15px/1.7 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    color: #e6e6e6; background: #16161e; }
  h1,h2,h3 { color: #bb9af7; }
  a { color: #7aa2f7; }
  code { background: #1e1e2e; padding: .15em .4em; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; color: #9ece6a; }
  pre { background: #1a1a24; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #7aa2f7; margin: 0; padding: .2em 1em; color: #a9b1d6; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #3b4261; padding: .35em .7em; }
  th { background: #1e1e2e; }
  hr { border: none; border-top: 1px solid #3b4261; }
  input[type=checkbox] { accent-color: #9ece6a; }
</style>
</head>
<body>
${html}
</body>
</html>`;
    const blob = new Blob([doc], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'export.html';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportPdf = () => {
    // 打印视图导出 PDF（浏览器原生，零依赖）
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Export</title>
<style>
  body { font: 13px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: #222; }
  h1,h2,h3 { color: #4c1d95; }
  code { background: #f1f1f1; padding: .1em .35em; border-radius: 3px; font-family: Menlo, monospace; font-size: .9em; }
  pre { background: #f6f6f6; padding: .8rem; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 3px solid #7c3aed; margin: 0; padding: .1em 1em; color: #555; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: .3em .6em; }
  hr { border: none; border-top: 1px solid #ccc; }
  input[type=checkbox] { accent-color: #4c1d95; }
  @media print { body { margin: 0; } }
</style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const modeBtn = (id: typeof mode, label: string, Icon: typeof Eye) => (
    <button
      onClick={() => setMode(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
        mode === id ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-card/50">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-violet-400" />
          <h1 className="text-base font-semibold font-mono tracking-wide">{t('markdown.title')}</h1>
          <span className="text-[10px] font-mono text-text-muted hidden md:inline">auto-saved ✦</span>
        </div>
        <div className="flex items-center gap-1">
          {modeBtn('edit', 'edit', Code2)}
          {modeBtn('split', 'split', Sparkles)}
          {modeBtn('preview', 'preview', Eye)}
          <div className="w-px h-5 bg-border mx-2" />
          <button onClick={copyHtml} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-muted hover:text-text-primary transition-colors">
            <Code2 className="w-4 h-4" /> {copied ? 'copied ✓' : 'html'}
          </button>
          <button onClick={exportHtml} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary border border-border hover:border-border-light transition-colors">
            <Download className="w-4 h-4" /> .html
          </button>
          <button onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors">
            <FileDown className="w-4 h-4" /> .pdf
          </button>
          <button
            onClick={() => setSrc('')}
            title="clear"
            className="p-1.5 rounded-lg text-text-muted hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            spellCheck={false}
            placeholder={t('markdown.placeholder')}
            className={`${mode === 'split' ? 'w-1/2' : 'w-full'} h-full resize-none outline-none bg-black/30 text-emerald-200 font-mono text-[13px] leading-relaxed p-5`}
          />
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div
            ref={printRef}
            className={`${mode === 'split' ? 'w-1/2' : 'w-full'} h-full overflow-y-auto bg-bg-card/30 p-6`}
          >
            <div
              className="geek-md max-w-2xl mx-auto"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
