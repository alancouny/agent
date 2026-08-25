// Minimal stdio MCP fixture server for R5 dangerous-tool tests.
// Exposes three tools: write_file (file-write), exec (shell), read_note (benign).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'dangerous-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'write_file',
      description: 'Write content to a file on disk',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'exec',
      description: 'Execute a shell command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
    {
      name: 'read_note',
      description: 'Read a note by id',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const text = name === 'read_note'
    ? `note: ${(args && args.id) || ''}`
    : `${name} called with ${JSON.stringify(args || {})}`;
  return { content: [{ type: 'text', text }], isError: false };
});

const transport = new StdioServerTransport();
await server.connect(transport);
