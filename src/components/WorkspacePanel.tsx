import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Folder,
  ChevronRight,
  ChevronDown,
  X,
  RefreshCw,
  Home,
  FolderOpen,
  FileText,
  Image,
  Code,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { logger } from '../utils/logger';
import { apiFetch } from '../api/client';
import { useAppStore } from '../store/useAppStore';

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.ps1', '.bat',
  '.py', '.java', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
  '.rb', '.swift', '.kt', '.scala', '.lua', '.r', '.m',
  '.sql', '.graphql', '.gql',
  '.env', '.gitignore', '.dockerignore',
  '.dockerfile', 'dockerfile',
]);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp']);

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

interface FileContent {
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  name: string;
  ext: string;
}

interface TreeItem extends FileEntry {
  children?: TreeItem[];
  expanded?: boolean;
  loading?: boolean;
}

function getApiBase(): string {
  try {
    const settings = useAppStore.getState().apiSettings;
    if (settings && settings.baseUrl) {
      return settings.baseUrl.replace(/\/v1$/, '').replace(/\/$/, '') + '/api';
    }
  } catch { /* ignore */ }
  return '/api';
}

/** 每次调用时求值 API 基址（模块加载时求值会导致 Settings 改地址后不生效）。 */
function apiUrl2(path: string): string {
  return getApiBase() + path;
}

async function listFiles(path: string, root: string | undefined, t: (k: string) => string): Promise<{ path: string; items: FileEntry[] }> {
  const params = new URLSearchParams({ path });
  if (root) params.set('root', root);
  const res = await apiFetch(`${apiUrl2('/workspace/files')}?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || t('workspace.errList'));
  }
  return res.json();
}

async function readFileContent(path: string, root: string | undefined, t: (k: string) => string): Promise<FileContent> {
  const params = new URLSearchParams({ path });
  if (root) params.set('root', root);
  const res = await apiFetch(`${apiUrl2('/workspace/files/read')}?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || t('workspace.errRead'));
  }
  return res.json();
}

async function getRoot(t: (k: string) => string): Promise<string> {
  const res = await apiFetch(`${apiUrl2('/workspace/root')}`);
  if (!res.ok) throw new Error(t('workspace.errRoot'));
  const data = await res.json();
  return data.root;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(ext: string) {
  if (IMAGE_EXTS.has(ext)) return <Image className="w-4 h-4 text-blue-400" />;
  if (TEXT_EXTS.has(ext)) return <Code className="w-4 h-4 text-green-400" />;
  return <FileText className="w-4 h-4 text-text-muted" />;
}

function renderPreview(content: FileContent) {
  if (content.encoding === 'base64') {
    // 扩展名白名单：服务端可控 ext 不能直接拼进 data URI（畸形/非预期 MIME 注入面）
    const SAFE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
    const ext = content.ext.toLowerCase().slice(1);
    const mimeExt = SAFE_IMAGE_EXTS.has(ext) ? ext : 'png';
    return (
      <div className="flex items-center justify-center h-full">
        <img
          src={`data:image/${mimeExt};base64,${content.content}`}
          alt={content.name}
          className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
        />
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-mono text-text-primary">
      {content.content}
    </pre>
  );
}

function TreeNode({
  item,
  depth,
  fullPath,
  onSelect,
  selectedPath,
  root,
}: {
  item: TreeItem;
  depth: number;
  fullPath: string;
  onSelect: (path: string, name: string, type: 'file' | 'directory') => void;
  selectedPath: string | null;
  root: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<TreeItem[] | null>(null);

  const handleToggle = useCallback(async () => {
    if (item.type !== 'directory') return;
    if (expanded && children) {
      setExpanded(false);
      return;
    }
    if (children && children.length > 0) {
      setExpanded(!expanded);
      return;
    }
    setExpanded(true);
    setLoading(true);
    try {
      const { items } = await listFiles(fullPath, root, t);
      setChildren(items);
    } catch (err) {
      logger.error('Failed to load directory', err);
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [item.type, expanded, children, fullPath, root, t]);

  const handleClick = () => {
    onSelect(fullPath, item.name, item.type);
  };

  const isSelected = selectedPath === fullPath;

  return (
    <div>
      <button
        onClick={handleClick}
        onDoubleClick={handleToggle}
        className={`w-full flex items-center gap-1.5 py-1 px-2 rounded-md transition-all duration-150 text-sm ${
          isSelected
            ? 'bg-primary/20 text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={fullPath}
      >
        {item.type === 'directory' && (
          <span className="w-4 flex-shrink-0 flex items-center justify-center">
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        {item.type === 'directory' ? (
          expanded ? (
            <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )
        ) : (
          <span className="w-4 flex-shrink-0 flex items-center justify-center">
            {getFileIcon('') /* generic file icon for tree; detail shown in preview */}
          </span>
        )}
        <span className="truncate flex-1">{item.name}</span>
        {loading && <RefreshCw className="w-3 h-3 animate-spin text-text-muted" />}
      </button>
      {expanded && children && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.name}
              item={child}
              depth={depth + 1}
              fullPath={fullPath + '/' + child.name}
              onSelect={onSelect}
              selectedPath={selectedPath}
              root={root}
            />
          ))}
        </div>
      )}
      {expanded && children && children.length === 0 && !loading && (
        <div
          className="py-1 text-xs text-text-muted"
          style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
        >
          (empty)
        </div>
      )}
    </div>
  );
}

function FilePreview({
  path,
  onClose,
  root,
}: {
  path: string;
  onClose: () => void;
  root: string;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);

    readFileContent(path, root, t)
      .then(setContent)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [path, root, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm text-text-muted">{t('workspace.loadingFile')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-2 text-red-400">
          <X className="w-8 h-8" />
          <span className="text-sm">{error}</span>
        </div>
      </div>
    );
  }

  if (!content) return null;

  const ext = content.ext.toLowerCase();

  return (
    <div className={`flex flex-col h-full ${fullScreen ? 'fixed inset-0 z-[100] bg-bg-dark p-4' : ''}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-card">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getFileIcon(ext)}
          <span className="text-sm font-medium text-text-primary truncate">{content.name}</span>
          <span className="text-xs text-text-muted ml-2 shrink-0">
            {formatSize(content.size)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            onClick={() => setFullScreen(!fullScreen)}
            className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title={fullScreen ? t('workspace.exitFullscreen') : t('workspace.fullscreen')}
          >
            {fullScreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {renderPreview(content)}
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  const { t } = useTranslation();
  const [root, setRoot] = useState<string>('');
  const [treeItems, setTreeItems] = useState<TreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const resizeRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getRoot(t);
      setRoot(r);
      const { items } = await listFiles('.', r, t);
      setTreeItems(items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  const handleSelect = useCallback((path: string, _name: string, _type: string) => {
    if (_type === 'file') {
      setSelectedPath(path);
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    setSelectedPath(null);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, e.clientX));
      setSidebarWidth(newWidth);
    };
    const handleUp = () => setResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing]);

  return (
    <div className="h-full flex flex-col overflow-auto bg-bg-dark">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-card">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <FolderOpen className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">{t('workspace.title')}</h2>
            <p className="text-xs text-text-muted truncate max-w-[400px]">{root}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadRoot}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => window.open(root, '_blank')}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title="Open in system"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File tree */}
        <div
          className="overflow-y-auto border-r border-border p-3 bg-bg-darker"
          style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
        >
          {loading && treeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-primary" />
              <span className="text-xs text-text-muted">{t('workspace.loadingWs')}</span>
            </div>
          ) : treeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
              <Folder className="w-8 h-8 opacity-50" />
              <span className="text-xs">{t('workspace.empty')}</span>
            </div>
          ) : (
            treeItems.map((item) => (
              <TreeNode
                key={item.name}
                item={item}
                depth={0}
                fullPath={item.name}
                onSelect={handleSelect}
                selectedPath={selectedPath}
                root={root}
              />
            ))
          )}
        </div>

        {/* Resize handle */}
        <div
          ref={resizeRef}
          className="w-1 cursor-col-resize hover:bg-primary/50 transition-colors flex-shrink-0"
          onMouseDown={() => setResizing(true)}
        />

        {/* File preview */}
        <div className="flex-1 overflow-hidden">
          {selectedPath ? (
            <FilePreview path={selectedPath} onClose={handleClosePreview} root={root} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
              <FileText className="w-12 h-12 opacity-30" />
              <p className="text-sm">{t('workspace.previewHint')}</p>
              <p className="text-xs opacity-70">{t('workspace.dblClickHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}