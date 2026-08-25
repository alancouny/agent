import { spawn, type ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type CpuStatus =
  | 'disabled'
  | 'mcp_missing'
  | 'ready'
  | 'running'
  | 'error';

export interface CpuStatusResult {
  status: CpuStatus;
  message: string;
  serverScript: string | null;
  serverPid: number | null;
  tools: CpuToolInfo[];
  error: string | null;
}

export interface CpuToolInfo {
  name: string;
  description: string;
  category: 'input' | 'output' | 'control' | 'monitor';
}

export interface CpuInstallResult {
  success: boolean;
  message: string;
  status: CpuStatus;
}

const TOOLS: CpuToolInfo[] = [
  { name: 'screenshot', description: 'Take a screenshot of the desktop', category: 'output' },
  { name: 'mouse_move', description: 'Move mouse cursor to x,y coordinates', category: 'input' },
  { name: 'mouse_click', description: 'Click mouse at current position or x,y', category: 'input' },
  { name: 'type_text', description: 'Type text into the active window', category: 'input' },
  { name: 'press_key', description: 'Press a key (enter, tab, escape, backspace, space, arrows, a-z)', category: 'input' },
  { name: 'scroll', description: 'Scroll up or down', category: 'input' },
  { name: 'clipboard_get', description: 'Read the current clipboard content', category: 'output' },
  { name: 'clipboard_set', description: 'Set the clipboard content', category: 'output' },
  { name: 'list_apps', description: 'List all visible running applications', category: 'monitor' },
  { name: 'list_windows', description: 'List all open window titles', category: 'monitor' },
  { name: 'find_text', description: 'Find text on screen via OCR', category: 'output' },
  { name: 'open_url', description: 'Open a URL in default browser', category: 'control' },
  { name: 'open_app', description: 'Open an application by name', category: 'control' },
];

export const CPU_SERVER_SCRIPT = join(__dirname, 'server.ts');
export const CPU_DATA_DIR = join(__dirname, '..', '..', 'data', 'computer-use');
export const CPU_PID_FILE = join(CPU_DATA_DIR, 'mcp.pid');

function findTsxBinary(): string | null {
  try {
    const tsxPath = require.resolve('tsx/dist/cli.mjs', { paths: [process.cwd()] });
    if (existsSync(tsxPath)) return tsxPath;
  } catch { /* ignore */ }
  return null;
}

class ComputerUseManager {
  private serverProcess: ChildProcess | null = null;

  getStatus(): CpuStatusResult {
    try {
      if (!existsSync(CPU_SERVER_SCRIPT)) {
        return {
          status: 'mcp_missing',
          message: 'MCP server script not found',
          serverScript: CPU_SERVER_SCRIPT,
          serverPid: null,
          tools: [],
          error: 'Computer Use MCP server is not installed',
        };
      }

      const pid = this.getServerPid();
      if (pid && this.serverProcess && this.serverProcess.exitCode === null) {
        return {
          status: 'running',
          message: 'Computer Use MCP server is running',
          serverScript: CPU_SERVER_SCRIPT,
          serverPid: pid,
          tools: TOOLS,
          error: null,
        };
      }

      return {
        status: 'ready',
        message: 'Computer Use is installed and ready. Start the MCP server to use.',
        serverScript: CPU_SERVER_SCRIPT,
        serverPid: null,
        tools: TOOLS,
        error: null,
      };
    } catch (err: unknown) {
      logger.error('ComputerUse status check failed', err);
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        message: 'Failed to check Computer Use status',
        serverScript: CPU_SERVER_SCRIPT,
        serverPid: null,
        tools: [],
        error: message,
      };
    }
  }

  startServer(): { success: boolean; message: string; pid?: number } {
    try {
      this.stopServer();

      if (!existsSync(CPU_DATA_DIR)) {
        mkdirSync(CPU_DATA_DIR, { recursive: true });
      }

      if (!existsSync(CPU_SERVER_SCRIPT)) {
        return { success: false, message: 'MCP server script not found' };
      }

      const nodePath = process.execPath;
      const tsxPath = findTsxBinary();

      if (!tsxPath) {
        return { success: false, message: 'tsx not found. Run npm install first.' };
      }

      this.serverProcess = spawn(nodePath, [tsxPath, CPU_SERVER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
        cwd: __dirname,
      });

      const pid = this.serverProcess.pid;
      if (!pid) {
        return { success: false, message: 'Failed to get server PID' };
      }

      writeFileSync(CPU_PID_FILE, String(pid));

      this.serverProcess.on('error', (err) => {
        logger.error('[ComputerUse] Server error', err.message);
      });

      this.serverProcess.on('close', (code) => {
        logger.info(`[ComputerUse] Server exited with code ${code}`);
        this.serverProcess = null;
        try { unlinkSync(CPU_PID_FILE); } catch { /* ignore */ }
      });

      this.serverProcess.stdout?.on('data', (data) => {
        logger.debug(`[ComputerUse MCP] ${data.toString().trim()}`);
      });
      this.serverProcess.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) logger.warn(`[ComputerUse MCP ERR] ${line}`);
      });

      return {
        success: true,
        message: `Computer Use MCP server started (PID: ${pid})`,
        pid,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ComputerUse start failed', err);
      return { success: false, message: `Failed to start: ${message}` };
    }
  }

  stopServer(): { success: boolean; message: string } {
    try {
      if (this.serverProcess && this.serverProcess.exitCode === null) {
        this.serverProcess.kill('SIGTERM');
        setTimeout(() => {
          if (this.serverProcess?.exitCode === null) {
            this.serverProcess?.kill('SIGKILL');
          }
        }, 3000);
      }
      this.serverProcess = null;

      const pid = this.getServerPid();
      if (pid && pid !== process.pid) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
      }

      try { unlinkSync(CPU_PID_FILE); } catch { /* ignore */ }

      return { success: true, message: 'Computer Use MCP server stopped' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ComputerUse stop failed', err);
      return { success: false, message: `Failed to stop: ${message}` };
    }
  }

  private getServerPid(): number | null {
    try {
      if (!existsSync(CPU_PID_FILE)) return null;
      const pid = parseInt(readFileSync(CPU_PID_FILE, 'utf-8').trim());
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return pid;
        } catch {
          try { unlinkSync(CPU_PID_FILE); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    return null;
  }
}

export const computerUseManager = new ComputerUseManager();