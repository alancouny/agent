/**
 * API 地址配置（双模式：本地 / 远程）
 *
 * - 本地（默认）：桌面/Web 开发连本地 backend。Web 用 vite 代理（相对路径 /api），
 *   Tauri 桌面客户端填 http://localhost:3001。
 * - 远程：移动端（iOS/Android）不能跑本地 Node 进程，必须连远程部署的 API 服务器，
 *   在 Settings 里填服务器地址。
 *
 * 持久化在 localStorage['api_base_url']；空字符串 = 相对路径（vite 代理）。
 */

const STORAGE_KEY = 'api_base_url';

/** Tauri 桌面/移动端运行环境（无 vite 代理，必须用完整地址） */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 当前 API 基础地址（不含 /api 前缀）；'' = 走相对路径 + vite 代理 */
export function getApiBase(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved;
    // Tauri 环境无代理，默认连本地 backend
    if (isTauri()) return 'http://localhost:3001';
    return '';
  } catch {
    return '';
  }
}

/** 设置 API 基础地址（去掉尾部斜杠）；'' 恢复为相对路径模式 */
export function setApiBase(url: string): void {
  const normalized = url.trim().replace(/\/+$/, '');
  localStorage.setItem(STORAGE_KEY, normalized);
}

/**
 * 拼出完整 API URL：
 * - 本地模式：path 原样返回（'/api/xxx' 交给 vite 代理）
 * - 远程模式：base + path（如 'https://api.example.com' + '/api/health'）
 */
export function apiUrl(path: string): string {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
}

/**
 * Agent API Key 统一来源（后端 T01 起强制鉴权）：
 * 1. VITE_AGENT_API_KEY 环境变量优先（本地开发推荐：后端启动日志会打印随机生成的 key，S4 默认方案）；
 * 2. 无环境变量时回退 localStorage['agent_api_key']（Settings → API Key 填写）。
 */
export function getAgentApiKey(): string {
  try {
    const envKey = import.meta.env?.VITE_AGENT_API_KEY;
    if (typeof envKey === 'string' && envKey.trim()) return envKey.trim();
  } catch { /* import.meta.env unavailable */ }
  try {
    return localStorage.getItem('agent_api_key') ?? '';
  } catch {
    return '';
  }
}
