import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, X, Eye, Layers, ChevronRight } from 'lucide-react';

// ── 类型 ────────────────────────────────────────────────────
export interface TrackedFile {
  /** 唯一键 = path */
  id: string;
  path: string;
  /** 相对路径（显示用） */
  displayName: string;
  operation: 'write' | 'create' | 'delete';
  lineCount: number;
  snippet: string;
  updatedAt: number;
  /** 原始内容（用于预览） */
  content?: string;
}

interface FileTrackerPanelProps {
  enabled: boolean;
  /** 受控：由父组件维护的文件列表（AgentChat 从 SSE file_modified 事件构建） */
  files: TrackedFile[];
  /** 受控：当前展开的文件 id */
  expandedId: string | null;
  onExpand?: (id: string | null) => void;
  /** 清除全部文件 */
  onClear?: () => void;
  onToggle?: () => void;
  onClose?: () => void;
}

/** 获取文件图标颜色 */
function extColor(ext: string): string {
  const map: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-300',
    js: 'text-yellow-400', jsx: 'text-yellow-300',
    py: 'text-green-400',
    json: 'text-green-300', yaml: 'text-green-300', yml: 'text-green-300',
    md: 'text-cyan-400',
    css: 'text-purple-400', scss: 'text-purple-300',
    html: 'text-orange-400',
    sql: 'text-amber-400',
    go: 'text-sky-400',
    rs: 'text-red-400',
    java: 'text-orange-300',
  };
  return map[ext] ?? 'text-text-secondary';
}

function ext(fullPath: string): string {
  const parts = fullPath.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/** 稳定字符串哈希（用于生成确定性条宽，替代渲染期 Math.random）。 */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── 组件（受控：files / expandedId 由父组件维护）─────────────
export function FileTrackerPanel({
  enabled,
  files,
  expandedId,
  onExpand,
  onClear,
  onToggle,
  onClose,
}: FileTrackerPanelProps) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!enabled) return null;

  const expanded = files.find(f => f.id === expandedId) ?? null;
  const secondary = files.filter(f => f.id !== expandedId);
  const displayCount = files.length;

  return (
    <div
      className="relative flex flex-col h-full bg-bg-darker/80 border-l border-border/60 backdrop-blur-sm"
      style={{ width: 320, flexShrink: 0 }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-card/40">
        <Layers className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-text-primary">{t('fileTracker.title')}</span>
        <div className="flex-1" />
        {displayCount > 0 && (
          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-mono">
            {displayCount}
          </span>
        )}
        <button
          onClick={onClear}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors px-1.5 py-0.5 rounded hover:bg-bg-hover"
          title={t('fileTracker.clearAll')}
        >
          {t('fileTracker.clear')}
        </button>
        <button
          onClick={() => { onClose?.(); onToggle?.(); }}
          className="text-text-muted hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-hover"
          title={t('fileTracker.closePanel')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── 空状态 ── */}
      {displayCount === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
          <FileText className="w-8 h-8 opacity-30" />
          <p className="text-xs text-center px-6 leading-relaxed">
            {t('fileTracker.emptyHint')}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted/60 mt-2">
            <ChevronRight className="w-3 h-3" />
            <span>{t('fileTracker.supportTools')}</span>
          </div>
        </div>
      )}

      {/* ── 文件列表 ── */}
      {displayCount > 0 && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {/* 展开的主文件 */}
          {expanded && (
            <FileCard
              key={expanded.id}
              file={expanded}
              isExpanded
              isHovered={hoveredId === expanded.id}
              onHover={(h) => setHoveredId(h ? expanded.id : null)}
              onClick={() => onExpand?.(expanded.id === expandedId ? null : expanded.id)}
              extColor={extColor(ext(expanded.path))}
            />
          )}

          {/* 次级文件缩略卡（带 frosted glass + 环绕布局） */}
          {secondary.map((f, i) => {
            // 环绕角度：均匀分布或按插入顺序
            const total = secondary.length;
            const angle = (i / Math.max(total, 1)) * 2 * Math.PI - Math.PI / 2;
            // 距离中心偏移（小偏移让卡片微微错开）
            const offsetDistance = 18;
            const dx = Math.cos(angle) * offsetDistance;
            const dy = Math.sin(angle) * offsetDistance * 0.5; // 垂直方向压缩
            const zIndex = secondary.length - i; // 后面的叠在上面

            return (
              <div
                key={f.id}
                style={{ transform: `translate(${dx}px, ${dy}px)`, zIndex }}
                className="transition-all duration-300 ease-out"
              >
                <FileCard
                  file={f}
                  isExpanded={false}
                  isHovered={hoveredId === f.id}
                  onHover={(h) => setHoveredId(h ? f.id : null)}
                  onClick={() => onExpand?.(f.id === expandedId ? null : f.id)}
                  extColor={extColor(ext(f.path))}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer 计数 ── */}
      {displayCount > 0 && (
        <div className="px-4 py-2.5 border-t border-border/40 text-[10px] text-text-muted flex items-center gap-2">
          <Eye className="w-3 h-3" />
          <span>
            {expanded
              ? `正在查看: ${expanded.displayName}`
              : `${displayCount} 个文件待查看`}
          </span>
        </div>
      )}
    </div>
  );
}

// ── 单文件卡片 ──────────────────────────────────────────────
interface FileCardProps {
  file: TrackedFile;
  isExpanded: boolean;
  isHovered: boolean;
  onHover: (hover: boolean) => void;
  onClick: () => void;
  extColor: string;
}

function FileCard({ file, isExpanded, isHovered, onHover, onClick, extColor }: FileCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`
        relative rounded-xl border cursor-pointer overflow-hidden
        transition-all duration-300 ease-out
        ${isExpanded
          ? 'border-primary/40 bg-bg-card/90 shadow-lg shadow-primary/10'
          : 'border-border/60 bg-bg-card/50 hover:border-primary/30'
        }
        ${isHovered && !isExpanded ? 'border-primary/50 bg-bg-hover/40 scale-[1.02]' : ''}
      `}
      style={isExpanded ? { minHeight: 200 } : {}}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      {/* 顶部栏 */}
      <div className={`flex items-center gap-2 px-3 py-2 ${isExpanded ? 'border-b border-border/40' : ''}`}>
        <span className={`text-xs font-mono ${extColor}`}>
          {isExpanded ? <FileText className="w-3.5 h-3.5" /> : <FileText className="w-3 h-3" />}
        </span>
        <span className="text-xs font-medium text-text-primary truncate flex-1" title={file.path}>
          {file.displayName}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          file.operation === 'create'
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-primary/15 text-primary'
        }`}>
          {file.operation === 'create' ? t('fileTracker.new') : t('fileTracker.modified')}
        </span>
        {!isExpanded && (
          <span className="text-[10px] text-text-muted font-mono">{file.lineCount}L</span>
        )}
      </div>

      {/* 内容预览 */}
      {isExpanded && (
        <div className="px-3 py-2.5 max-h-60 overflow-y-auto font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
          {file.snippet || <span className="text-text-muted/50 italic">{t('fileTracker.noPreview')}</span>}
        </div>
      )}

      {/* 未展开时的行高条（视觉指示） */}
      {!isExpanded && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(file.lineCount, 8) }).map((_, i) => (
              <div
                key={i}
                className="h-0.5 rounded-full bg-primary/30 transition-all duration-200"
                style={{
                  // 用路径哈希生成稳定宽度（原 Math.random 每次渲染抖动且非确定性）
                  width: `${6 + ((hashCode(file.path) + i * 7) % 16)}px`,
                  opacity: 0.3 + (i / Math.max(file.lineCount, 1)) * 0.5,
                }}
              />
            ))}
            {file.lineCount > 8 && (
              <span className="text-[9px] text-text-muted/50 ml-1">+{file.lineCount - 8}</span>
            )}
          </div>
        </div>
      )}

      {/* 展开态：底部信息 */}
      {isExpanded && (
        <div className="px-3 py-2 border-t border-border/30 flex items-center justify-between text-[10px] text-text-muted">
          <span className="font-mono truncate max-w-[70%]" title={file.path}>{file.path}</span>
          <span>{file.lineCount} {t('fileTracker.lines')}</span>
        </div>
      )}
    </div>
  );
}
