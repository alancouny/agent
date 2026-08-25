/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'path';
import { toolRegistry } from './registry.js';
import { executeCommand } from '../computer-use/handlers.js';
import { resolveWorkspaceRoot, listDirectory } from '../workspace/fs.js';

// ========== Run Command Tool ==========
// Lets the agent execute shell commands on the host — the same capability the
// Terminal panel exposes via POST /api/terminal/execute. Approval-gated because
// commands can be destructive.
toolRegistry.register('run_command', {
  schema: {
    name: 'run_command',
    description:
      'Execute a shell command on the host (zsh). Use for building, testing, git operations, file ops, and running scripts. Destructive commands require approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: {
          type: 'string',
          description: 'Working directory (absolute, or relative to the workspace root). Defaults to the workspace root.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (1-120). Defaults to 30.',
        },
      },
      required: ['command'],
    },
  },
  handler: async ({ command, cwd, timeout }: any) => {
    const workDir = cwd
      ? path.isAbsolute(cwd)
        ? cwd
        : path.join(resolveWorkspaceRoot(), cwd)
      : undefined;
    const result = await executeCommand({ command, cwd: workDir, timeout });
    if (!result.success && !result.output) {
      return { success: false, output: result.output || 'Command failed', error: 'COMMAND_FAILED' };
    }
    return { success: result.success, output: result.output };
  },
  category: 'system',
  requiresApproval: true,
  enabled: true,
});

// ========== List Files Tool ==========
// Enumerates the workspace. Read-only and restricted to the workspace root, so
// it does not require approval. Pairs with the built-in read_file/write_file
// (which operate on absolute paths) to give the agent filesystem visibility.
toolRegistry.register('list_files', {
  schema: {
    name: 'list_files',
    description:
      'List files and directories in the workspace. Paths are confined to the workspace root. Use this to discover what is in the project before reading or editing.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to list (absolute, or relative to the workspace root). Defaults to the root.',
        },
      },
      required: [],
    },
  },
  handler: async ({ path: relPath }: any) => {
    const root = resolveWorkspaceRoot();
    const { items } = await listDirectory(root, relPath || '.');
    return {
      success: true,
      output: JSON.stringify(items, null, 2),
      data: { root, items },
    };
  },
  category: 'filesystem',
  requiresApproval: false,
  readOnly: true,
  enabled: true,
});
