import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createCtxhubMcpServer } from './server.js';
import { listWorkspaces } from '../workspaces/registry.js';
import { getPackageVersion } from '../utils/version.js';

// docs/control-plane.md Phase 5: routes MCP tool calls into isolated per-workspace runtimes.
// Deliberately a thin router, not a second copy of ctxhub's real MCP surface: each named
// workspace gets its own createCtxhubMcpServer instance (the exact same tool set a plain
// `ctxhub mcp` already exposes for that workspace), connected in-process via an SDK
// InMemoryTransport pair rather than re-declaring every tool's schema here. Never merges
// workspaces into one global index or search space -- a caller always names exactly which
// workspace a tool call targets.
export function createCentralMcpServer(opts: { allowIndex?: boolean; allowMemoryWrite?: boolean } = {}): McpServer {
  const server = new McpServer({ name: 'ctxhub-central', version: getPackageVersion() });
  const clients = new Map<string, Client>();

  async function clientFor(workspaceName: string): Promise<Client> {
    const existing = clients.get(workspaceName);
    if (existing) return existing;

    const workspaces = await listWorkspaces();
    const workspaceEntry = workspaces.find(entry => entry.name === workspaceName);
    if (!workspaceEntry) {
      throw new Error(`No registered workspace named "${workspaceName}". Run: ctxhub workspace list`);
    }
    if (!workspaceEntry.exists) {
      throw new Error(`Workspace "${workspaceName}" is registered but its path no longer exists: ${workspaceEntry.path}`);
    }

    const workspaceServer = createCtxhubMcpServer(workspaceEntry.path, opts);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await workspaceServer.connect(serverTransport);

    const client = new Client({ name: 'ctxhub-central-gateway', version: getPackageVersion() });
    await client.connect(clientTransport);

    clients.set(workspaceName, client);
    return client;
  }

  server.registerTool(
    'list_workspaces',
    {
      title: 'List registered ctxhub workspaces',
      description: 'List workspaces registered with `ctxhub workspace register`, for use with call_workspace_tool.',
      inputSchema: {}
    },
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ workspaces: await listWorkspaces() }) }] })
  );

  server.registerTool(
    'call_workspace_tool',
    {
      title: 'Call a ctxhub MCP tool in a specific registered workspace',
      description:
        'Route a normal ctxhub MCP tool call (search, context_pack, memory_search, etc.) into a specific ' +
        'registered workspace\'s own isolated ctxhub MCP server. Workspaces are never merged into one global ' +
        'index -- name exactly which one to query (see list_workspaces).',
      inputSchema: {
        workspace: z.string().describe('Registered workspace name (see list_workspaces)'),
        tool: z.string().describe('The ctxhub MCP tool name to call in that workspace, e.g. "search" or "context_pack"'),
        arguments: z.record(z.string(), z.unknown()).optional().describe('Arguments for that tool, as it would normally receive them')
      }
    },
    async ({ workspace, tool, arguments: toolArguments }) => {
      const client = await clientFor(workspace);
      const result = await client.callTool({ name: tool, arguments: toolArguments ?? {} }, CallToolResultSchema);
      // The SDK's own Client.callTool() return type and McpServer.registerTool()'s expected
      // handler return type are structurally the same CallToolResult shape (both conform to
      // CallToolResultSchema), but declared via different internal type aliases that TS won't
      // unify -- verified at runtime against a real workspace tool call, not just asserted here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as any;
    }
  );

  return server;
}

export async function startCentralMcpServer(opts: { allowIndex?: boolean; allowMemoryWrite?: boolean } = {}): Promise<void> {
  const server = createCentralMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ctxhub] Central MCP gateway started -- routing into registered workspaces (docs/control-plane.md Phase 5).');
}
