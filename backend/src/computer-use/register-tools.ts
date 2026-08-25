/* eslint-disable @typescript-eslint/no-explicit-any */
import { toolRegistry } from '../tools/registry.js';
import * as handlers from './handlers.js';

const CAT = 'computer-use';

toolRegistry.register('computer_use.screenshot', {
  schema: {
    name: 'computer_use.screenshot',
    description: 'Take a screenshot of the desktop. Requires macOS.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  handler: async () => handlers.screenshot(),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.mouse_move', {
  schema: {
    name: 'computer_use.mouse_move',
    description: 'Move mouse cursor to x,y coordinates. Requires macOS.',
    parameters: { type: 'object', properties: {
      x: { type: 'number', description: 'X coordinate' },
      y: { type: 'number', description: 'Y coordinate' },
    }, required: ['x', 'y'] }
  },
  handler: async (args: any) => handlers.mouseMove(args),
  category: CAT, requiresApproval: true, enabled: true,
});

toolRegistry.register('computer_use.mouse_click', {
  schema: {
    name: 'computer_use.mouse_click',
    description: 'Click mouse at current position or at x,y. Requires macOS.',
    parameters: { type: 'object', properties: {
      x: { type: 'number', description: 'X coordinate (optional)' },
      y: { type: 'number', description: 'Y coordinate (optional)' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
      clicks: { type: 'number', description: 'Number of clicks' },
    }, required: [] }
  },
  handler: async (args: any) => handlers.mouseClick(args),
  category: CAT, requiresApproval: true, enabled: true,
});

toolRegistry.register('computer_use.type_text', {
  schema: {
    name: 'computer_use.type_text',
    description: 'Type text into the active window. Requires macOS.',
    parameters: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to type' },
    }, required: ['text'] }
  },
  handler: async (args: any) => handlers.typeText(args),
  category: CAT, requiresApproval: true, enabled: true,
});

toolRegistry.register('computer_use.press_key', {
  schema: {
    name: 'computer_use.press_key',
    description: 'Press a key (enter, tab, escape, backspace, space, up, down, left, right, a-z). Requires macOS.',
    parameters: { type: 'object', properties: {
      key: { type: 'string', description: 'Key name or single character' },
    }, required: ['key'] }
  },
  handler: async (args: any) => handlers.pressKey(args),
  category: CAT, requiresApproval: true, enabled: true,
});

toolRegistry.register('computer_use.scroll', {
  schema: {
    name: 'computer_use.scroll',
    description: 'Scroll up or down. Requires macOS.',
    parameters: { type: 'object', properties: {
      direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
      amount: { type: 'number', description: 'Scroll amount in pixels' },
    }, required: [] }
  },
  handler: async (args: any) => handlers.scroll(args),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.clipboard_get', {
  schema: {
    name: 'computer_use.clipboard_get',
    description: 'Read the current clipboard text.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  handler: async () => handlers.clipboardGet(),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.clipboard_set', {
  schema: {
    name: 'computer_use.clipboard_set',
    description: 'Set clipboard text.',
    parameters: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to set' },
    }, required: ['text'] }
  },
  handler: async (args: any) => handlers.clipboardSet(args),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.list_apps', {
  schema: {
    name: 'computer_use.list_apps',
    description: 'List all visible running applications. Requires macOS.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  handler: async () => handlers.listApps(),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.list_windows', {
  schema: {
    name: 'computer_use.list_windows',
    description: 'List all open window titles. Requires macOS.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  handler: async () => handlers.listWindows(),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.find_text', {
  schema: {
    name: 'computer_use.find_text',
    description: 'Find text on screen via OCR (requires tesseract). Requires macOS.',
    parameters: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to find on screen' },
    }, required: ['text'] }
  },
  handler: async (args: any) => handlers.findText(args),
  category: CAT, requiresApproval: false, enabled: true,
});

toolRegistry.register('computer_use.open_url', {
  schema: {
    name: 'computer_use.open_url',
    description: 'Open a URL in the default browser.',
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: 'URL to open' },
    }, required: ['url'] }
  },
  handler: async (args: any) => handlers.openUrl(args),
  category: CAT, requiresApproval: true, enabled: true,
});

toolRegistry.register('computer_use.open_app', {
  schema: {
    name: 'computer_use.open_app',
    description: 'Open an application by name. Requires macOS.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'Application name' },
    }, required: ['name'] }
  },
  handler: async (args: any) => handlers.openApp(args),
  category: CAT, requiresApproval: true, enabled: true,
});

toolRegistry.register('terminal.execute', {
  schema: {
    name: 'terminal.execute',
    description: 'Execute a single shell command and return stdout/stderr. Shell metacharacters (pipes, redirects, chaining like ; && ||) and shell wrappers (sh/bash/zsh) are rejected for security.',
    parameters: { type: 'object', properties: {
      command: { type: 'string', description: 'Shell command to execute (single command, no metacharacters)' },
      cwd: { type: 'string', description: 'Working directory (defaults to process cwd)' },
      timeout: { type: 'number', description: 'Timeout in seconds (1-120, default 30)' },
    }, required: ['command'] }
  },
  handler: async (args: any) => handlers.executeCommand(args),
  category: CAT, requiresApproval: true, enabled: true,
});
