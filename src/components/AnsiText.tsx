import { memo, useMemo } from 'react';

// ── ANSI SGR → React 元素渲染 ──────────────────────────────
// 终端彩色输出（256 色/真彩色/基础色 + 粗斜下划线反显）转 HTML 结构。
// 解析为 token 数组再映射为 <span>，支持任意嵌套样式组合。

const BASE_COLORS = [
  '#1e1e2e', '#f7768e', '#9ece6a', '#e0af68',
  '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
];
const BRIGHT_COLORS = [
  '#414868', '#ff9eac', '#c9ff9e', '#ffd47e',
  '#aab7ff', '#d7b5ff', '#b1f2ff', '#ffffff',
];

interface Style {
  color?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

function parseSgr(sgr: string, st: Style): Style {
  if (!sgr) return { ...st }; // ESC[m == 重置
  const codes = sgr.split(';').map(Number);
  const next = { ...st };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) {
      next.color = undefined; next.bg = undefined;
      next.bold = next.italic = next.underline = next.inverse = false;
    } else if (c === 1) next.bold = true;
    else if (c === 3) next.italic = true;
    else if (c === 4) next.underline = true;
    else if (c === 7) next.inverse = true;
    else if (c >= 30 && c <= 37) next.color = BASE_COLORS[c - 30];
    else if (c >= 90 && c <= 97) next.color = BRIGHT_COLORS[c - 90];
    else if (c >= 40 && c <= 47) next.bg = BASE_COLORS[c - 40];
    else if (c >= 100 && c <= 107) next.bg = BRIGHT_COLORS[c - 100];
    else if (c === 38 && codes[i + 1] === 5) { next.color = indexColor(codes[i + 2]); i += 2; }
    else if (c === 38 && codes[i + 1] === 2) {
      next.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
    else if (c === 48 && codes[i + 1] === 5) { next.bg = indexColor(codes[i + 2]); i += 2; }
    else if (c === 48 && codes[i + 1] === 2) {
      next.bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  return next;
}

function indexColor(n: number): string {
  // 256 色：16 基础色 + 6×6×6 立方体 + 24 级灰度（粗略近似）
  if (n < 16) return (n < 8 ? BASE_COLORS : BRIGHT_COLORS)[n % 8];
  if (n < 232) {
    const i = n - 16;
    const r = Math.round((Math.floor(i / 36) * 255) / 5);
    const g = Math.round((Math.floor((i % 36) / 6) * 255) / 5);
    const b = Math.round(((i % 6) * 255) / 5);
    return `rgb(${r},${g},${b})`;
  }
  const v = Math.round(((n - 232) * 255) / 23);
  return `rgb(${v},${v},${v})`;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[([0-9;]*)m/g;

interface Token { text: string; style: Style; }

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let style: Style = {};
  let last = 0;
  ANSI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANSI_RE.exec(input)) !== null) {
    if (m.index > last) tokens.push({ text: input.slice(last, m.index), style });
    style = parseSgr(m[1], style);
    last = m.index + m[0].length;
  }
  if (last < input.length) tokens.push({ text: input.slice(last), style });
  return tokens;
}

/**
 * 渲染含 ANSI 转义序列的文本（终端输出）。
 * 未包含任何 ANSI 码时退化为纯 <pre>，避免无谓开销。
 */
export const AnsiText = memo(function AnsiText({
  text,
  className,
  dim = false,
}: {
  text: string;
  className?: string;
  /** 无 ANSI 码时也用等宽暗色样式（极客终端观感） */
  dim?: boolean;
}) {
  const tokens = useMemo(() => (text.includes('\x1b[') ? tokenize(text) : null), [text]);
  const base = 'font-mono whitespace-pre-wrap break-words';
  if (!tokens) {
    return <pre className={`${base} ${dim ? 'text-text-secondary' : ''} ${className ?? ''}`}>{text}</pre>;
  }
  return (
    <pre className={`${base} ${className ?? ''}`}>
      {tokens.map((t, i) => (
        <span
          key={i}
          style={{
            color: t.style.color,
            backgroundColor: t.style.bg,
            fontWeight: t.style.bold ? 700 : undefined,
            fontStyle: t.style.italic ? 'italic' : undefined,
            textDecoration: t.style.underline ? 'underline' : undefined,
            ...(t.style.inverse
              ? { color: t.style.bg || '#c0caf5', backgroundColor: t.style.color || '#1e1e2e' }
              : {}),
          }}
        >
          {t.text}
        </span>
      ))}
    </pre>
  );
});
