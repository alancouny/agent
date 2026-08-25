// Minimal stdio MCP fixture server for tests.
// Exposes a single tool `ping` that echoes the input back.
// Start: node echo-server.mjs

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'echo-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ping',
      description: 'Echo back the message parameter',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Message to echo' } },
        required: ['message'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== 'ping') {
    return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  }
  const message = (args && args.message) || '';
  return {
    content: [{ type: 'text', text: `pong: ${message}` }],
    isError: false,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
