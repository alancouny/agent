// Shared desktop control handlers — used by both the MCP server process and the toolRegistry

import { exec, execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { assertSafeCommand } from '../utils/safeCommand.js';

const execFileP = promisify(execFile);
const execP = promisify(exec);

function isMac(): boolean { return process.platform === 'darwin'; }

function runOsascript(script: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = spawnSync('osascript', ['-e', script]);
    return {
      ok: r.status === 0 && !r.error,
      stdout: r.stdout?.toString() || '',
      stderr: r.stderr?.toString() || '',
    };
  } catch {
    return { ok: false, stdout: '', stderr: 'osascript not available' };
  }
}

export async function screenshot(): Promise<{ success: boolean; output: string }> {
  if (isMac()) {
    try {
      await execFileP('screencapture', ['-x', '/tmp/cu-screenshot.png']);
      return { success: true, output: 'Screenshot captured at /tmp/cu-screenshot.png' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `screencapture error: ${message}` };
    }
  }
  return { success: false, output: 'screenshot not implemented for this OS' };
}

export async function mouseMove({ x, y }: { x: number; y: number }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'mouse_move not implemented for this OS' };
  // 数值化校验：非数字输入直接拒绝，防止 AppleScript 注入
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return { success: false, output: 'mouse_move requires numeric x/y' };
  }
  const r = runOsascript(
    `tell application "System Events" to set position of item 1 of every process whose frontmost is true to {${Math.round(nx)}, ${Math.round(ny)}}`
  );
  return { success: r.ok, output: r.ok ? `Mouse moved to (${nx},${ny})` : `mouse_move failed: ${r.stderr}` };
}

export async function mouseClick(args: { x?: number; y?: number; button?: string; clicks?: number }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'mouse_click not implemented for this OS' };
  if (args.x !== undefined && args.y !== undefined) await mouseMove({ x: args.x, y: args.y });
  const btn = args.button === 'right' ? 'second' : args.button === 'middle' ? 'middle' : '';
  const clicks = args.clicks ?? 1;
  const script = clicks > 1
    ? `repeat ${clicks} times\n  tell application "System Events" to ${btn} click of item 1 of every process whose frontmost is true\nend repeat`
    : `tell application "System Events" to ${btn} click of item 1 of every process whose frontmost is true`;
  const r = runOsascript(script);
  return { success: r.ok, output: r.ok ? `Mouse ${args.button || 'left'} clicked ${clicks}x` : `mouse_click failed: ${r.stderr}` };
}

export async function typeText({ text }: { text: string }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'type_text not implemented for this OS' };
  // 完整转义：先反斜杠、再引号与换行，防止 AppleScript 注入
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const r = runOsascript(`tell application "System Events" to keystroke "${escaped}"`);
  return { success: r.ok, output: r.ok ? `Typed: "${text}"` : `type_text failed: ${r.stderr}` };
}

export async function pressKey({ key }: { key: string }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'press_key not implemented for this OS' };
  const keyCodes: Record<string, number> = {
    enter: 36, return: 36, tab: 48, escape: 53, backspace: 51,
    space: 49, delete: 51, up: 126, down: 125, left: 123, right: 124,
  };
  const code = keyCodes[key.toLowerCase()];
  if (code === undefined && key.length === 1) {
    // 单字符分支同样完整转义，防注入
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const r = runOsascript(`tell application "System Events" to keystroke "${escaped}"`);
    return { success: r.ok, output: r.ok ? `Pressed: ${key}` : `press_key failed: ${r.stderr}` };
  }
  if (code === undefined) return { success: false, output: `Unknown key: ${key}` };
  const r = runOsascript(`tell application "System Events" to key code ${code}`);
  return { success: r.ok, output: r.ok ? `Pressed: ${key}` : `press_key failed: ${r.stderr}` };
}

export async function scroll({ direction = 'down', amount = 100 }: { direction?: string; amount?: number }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'scroll not implemented for this OS' };
  const delta = direction === 'up' ? -amount : amount;
  const r = runOsascript(`tell application "System Events" to tell process 1 to scroll click {100, 100} scroll delta ${delta}`);
  return { success: r.ok, output: r.ok ? `Scrolled ${direction} by ${amount}` : `scroll failed: ${r.stderr}` };
}

export async function clipboardGet(): Promise<{ success: boolean; output: string }> {
  if (isMac()) {
    const r = spawnSync('pbpaste', []);
    return { success: true, output: r.stdout?.toString().trim() || '(empty)' };
  }
  if (process.platform === 'linux') {
    const r = spawnSync('xclip', ['-selection', 'clipboard', '-o']);
    return { success: true, output: r.stdout?.toString().trim() || '(empty)' };
  }
  return { success: false, output: 'clipboard_get not implemented' };
}

export async function clipboardSet({ text }: { text: string }): Promise<{ success: boolean; output: string }> {
  if (isMac()) {
    const r = spawnSync('pbcopy', [], { input: text });
    return { success: r.status === 0, output: r.status === 0 ? 'Clipboard set' : 'clipboard_set failed' };
  }
  if (process.platform === 'linux') {
    const r = spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
    return { success: r.status === 0, output: r.status === 0 ? 'Clipboard set' : 'clipboard_set failed' };
  }
  return { success: false, output: 'clipboard_set not implemented' };
}

export async function listApps(): Promise<{ success: boolean; output: string }> {
  if (isMac()) {
    const r = runOsascript(`tell application "System Events" to get name of every application process whose visible is true`);
    if (r.ok) return { success: true, output: r.stdout || '(no apps)' };
    const r2 = spawnSync('lsappinfo', ['list']);
    if (r2.status === 0) return { success: true, output: r2.stdout?.toString() || '' };
  }
  return { success: false, output: 'list_apps not implemented' };
}

export async function listWindows(): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'list_windows not implemented for this OS' };
  const r = runOsascript(`
    tell application "System Events"
      set winList to {}
      repeat with app in every application process whose visible is true
        set appWins to name of every window of app
        repeat with w in appWins
          set end of winList to (name of app) & ": " & w
        end repeat
      end repeat
      return winList as string
  `);
  return { success: r.ok, output: r.ok ? r.stdout : r.stderr || '(no windows)' };
}

export async function findText({ text }: { text: string }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'find_text not implemented for this OS' };
  try {
    spawnSync('screencapture', ['-x', '/tmp/cu-find.png']);
    const r = spawnSync('tesseract', ['/tmp/cu-find.png', 'stdout', '-l', 'eng', '--psm', '6']);
    const ocr = r.stdout?.toString() || '';
    if (ocr.toLowerCase().includes(text.toLowerCase())) {
      const lines = ocr.split('\n');
      const foundLine = lines.findIndex(l => l.toLowerCase().includes(text.toLowerCase()));
      return { success: true, output: `Found "${text}" on screen (line ${foundLine + 1} of OCR text)` };
    }
    return { success: false, output: `Text "${text}" not found on screen` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: `find_text error: ${message} (requires tesseract)` };
  }
}

export async function openUrl({ url }: { url: string }): Promise<{ success: boolean; output: string }> {
  if (isMac()) {
    const r = spawnSync('open', [url]);
    return { success: r.status === 0, output: r.status === 0 ? `Opened ${url}` : 'open_url failed' };
  }
  if (process.platform === 'win32') {
    const r = spawnSync('cmd', ['/c', 'start', url]);
    return { success: r.status === 0, output: r.status === 0 ? `Opened ${url}` : 'open_url failed' };
  }
  if (process.platform === 'linux') {
    const r = spawnSync('xdg-open', [url]);
    return { success: r.status === 0, output: r.status === 0 ? `Opened ${url}` : 'open_url failed' };
  }
  return { success: false, output: 'open_url not implemented' };
}

export async function openApp({ name }: { name: string }): Promise<{ success: boolean; output: string }> {
  if (!isMac()) return { success: false, output: 'open_app not implemented for this OS' };
  const r = spawnSync('open', ['-a', name]);
  if (r.status === 0) return { success: true, output: `Opened ${name}` };
  return { success: false, output: `App "${name}" not found` };
}

export async function executeCommand(
  { command, cwd, timeout }: { command: string; cwd?: string; timeout?: number }
): Promise<{ success: boolean; output: string }> {
  if (!command || command.trim().length === 0) {
    return { success: false, output: 'command is empty' };
  }
  const t = timeout ?? 30;
  if (t < 1 || t > 120) {
    return { success: false, output: 'timeout must be between 1 and 120 seconds' };
  }
  // 安全收口：所有命令执行（terminal 路由 / run_command 工具 / terminal.execute 工具）
  // 统一先过 assertSafeCommand（元字符/命令包装器检测），杜绝绕过校验直达 shell。
  // 与 routes/terminal.ts 的入口校验使用同一谓词——已通过入口校验的命令必然再次通过，
  // 不会造成二次拦截；未校验路径（run_command 等）在此被拦截。
  try {
    assertSafeCommand(command);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'command rejected by safety check';
    return { success: false, output: msg };
  }
  const workDir = cwd ? path.resolve(cwd) : process.cwd();
  try {
    const { stdout, stderr } = await execP(command, {
      cwd: workDir,
      timeout: t * 1000,
      shell: 'zsh',
    });
    const out = stdout.trim();
    const err = stderr.trim();
    let output = out ? `stdout:\n${out}` : '';
    if (err) output += output ? `\n\nstderr:\n${err}` : `stderr:\n${err}`;
    if (!output) output = '(no output)';
    return { success: true, output };
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; signal?: string };
    const msg = e.message || String(err);
    if (e.code === 'ETIMEDOUT') {
      return { success: false, output: `Command timed out after ${t}s` };
    }
    if (e.signal === 'SIGTERM') {
      return { success: false, output: 'Command killed (timeout)' };
    }
    return { success: false, output: msg.replace(/^\s*Command failed:\s*/i, '') || msg };
  }
}