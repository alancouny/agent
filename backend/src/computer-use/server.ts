import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as handlers from './handlers.js';

type ToolArgs = Record<string, unknown>;
type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function routeLogsToStderr(): void {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      process.stderr.write(`${args.map(String).join(' ')}\n`);
    };
  }
}

const server = new McpServer({ name: 'agent-computer-use', version: '1.0.0' });

function textResult(output: string): ToolResult {
  return { content: [{ type: 'text', text: output }] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('screenshot', 'Take a screenshot of the desktop', {} as any, async (): Promise<ToolResult> => {
  const r = await handlers.screenshot();
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('mouse_move', 'Move mouse cursor to x,y coordinates', z.object({ x: z.number(), y: z.number() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.mouseMove(_args as { x: number; y: number });
  return textResult(r.output);
});

server.tool('mouse_click', 'Click mouse at current position or at x,y',
  z.object({
    x: z.number().optional(), y: z.number().optional(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    clicks: z.number().default(1),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.mouseClick(_args as { x?: number; y?: number; button?: string; clicks?: number });
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('type_text', 'Type text into the active window', z.object({ text: z.string() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.typeText(_args as { text: string });
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('press_key', 'Press a key (enter, tab, escape, backspace, space, up, down, left, right, a-z)', z.object({ key: z.string() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.pressKey(_args as { key: string });
  return textResult(r.output);
});

server.tool('scroll', 'Scroll up or down',
  z.object({
    direction: z.enum(['up', 'down']).default('down'),
    amount: z.number().default(100),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await handlers.scroll(_args as any);
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('clipboard_get', 'Read current clipboard text', {} as any, async (): Promise<ToolResult> => {
  const r = await handlers.clipboardGet();
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('clipboard_set', 'Set clipboard text', z.object({ text: z.string() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.clipboardSet(_args as { text: string });
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('list_apps', 'List all visible running applications', {} as any, async (): Promise<ToolResult> => {
  const r = await handlers.listApps();
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('list_windows', 'List all open window titles', {} as any, async (): Promise<ToolResult> => {
  const r = await handlers.listWindows();
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('find_text', 'Find text on screen via OCR', z.object({ text: z.string() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.findText(_args as { text: string });
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('open_url', 'Open a URL in default browser', z.object({ url: z.string() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.openUrl(_args as { url: string });
  return textResult(r.output);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.tool('open_app', 'Open an application by name', z.object({ name: z.string() }) as any, async (_args: ToolArgs): Promise<ToolResult> => {
  const r = await handlers.openApp(_args as { name: string });
  return textResult(r.output);
});

async function main(): Promise<void> {
  routeLogsToStderr();

  const transport = new StdioServerTransport();
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdin.off('end', shutdown);
    process.stdin.off('close', shutdown);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    // Access private field for cleanup — MCP SDK limitation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transport as any)['onclose'] = undefined;
    server.close();
  };

  // Access private field for event wiring — MCP SDK limitation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (transport as any)['onclose'] = shutdown;
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`MCP server error: ${(err as { message?: string }).message ?? String(err)}\n`);
  process.exit(1);
});
