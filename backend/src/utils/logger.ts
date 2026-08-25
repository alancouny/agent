import { getRequestId } from './request-context.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel) {
  return levelOrder[level] >= levelOrder[currentLevel];
}

function format(level: LogLevel, msg: string) {
  const ts = new Date().toISOString();
  // 请求上下文存在时追加 rid 段（无则省略，保持既有输出格式兼容）
  const rid = getRequestId();
  const ridPart = rid ? ` [rid=${rid}]` : '';
  return `[${ts}] [${level.toUpperCase()}]${ridPart} ${msg}`;
}

function log(level: LogLevel, message: string, ...args: unknown[]) {
  if (!shouldLog(level)) return;
  const line = format(level, message);
  if (level === 'error') {
    console.error(line, ...args);
  } else {
    console.log(line, ...args);
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
};
