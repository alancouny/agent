export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel: LogLevel = import.meta.env?.DEV ? 'debug' : 'warn';

function shouldLog(level: LogLevel) {
  return levelOrder[level] >= levelOrder[currentLevel];
}

function log(level: LogLevel, message: string, ...args: unknown[]) {
  if (!shouldLog(level)) return;
  const prefix = `[${level.toUpperCase()}]`;
  // In production, avoid noisy logs. Keep errors always.
  if (level === 'error') {
    console.error(prefix, message, ...args);
  } else if (import.meta.env?.DEV) {
    // console[level] is valid at runtime when level is a keyof Console
    console[level](prefix, message, ...args);
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
};
