import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerMcpTools, type McpToolDeps } from './tools';

/** One stateless server and transport per HTTP request; SDK transports cannot be reused. */
export async function handleMcpRequest(request: Request, deps: McpToolDeps): Promise<Response> {
  const server = new McpServer({ name: 'issue-board', version: '1.0.0' });
  registerMcpTools(server, deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
