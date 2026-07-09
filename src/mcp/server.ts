import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function createCtxhubMcpServer(cwd = process.cwd()): McpServer {
  const server = new McpServer({ name: 'ctxhub', version: '0.1.0' });

  server.registerTool(
    'search',
    {
      title: 'Search workspace knowledge',
      description:
        'Search docs/source across EVERY repo in this multi-repo workspace, including repos other than ' +
        'the one currently open. Use this before answering questions about how another service works, ' +
        'which repo owns a capability, cross-repo integration behavior, or past decisions — anywhere the ' +
        'answer might live outside the current repo. Returns ranked chunks with repo, path, heading, ' +
        'snippet, and commit.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 5)')
      }
    },
    async ({ query, limit }) => {
      const config = await loadConfig(cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
      const results = await index.search(query, limit ?? 5);
      return textResult(results);
    }
  );

  server.registerTool(
    'memory_status',
    {
      title: 'Memory and index status',
      description:
        'Report the ctxhub memory provider status (e.g. MemPalace availability) and the document ' +
        'index status (provider, chunk count, last indexed time). Use this to check whether the ' +
        'workspace index is stale before trusting search results, or to confirm ctxhub is set up at all.',
      inputSchema: {}
    },
    async () => {
      const config = await loadConfig(cwd);
      const memory = createMemoryAdapter(config.memory.provider, config.memory.path, cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
      const [memoryStatus, indexStatus] = await Promise.all([memory.status(), index.status()]);
      return textResult({ memory: memoryStatus, index: indexStatus });
    }
  );

  server.registerTool(
    'repo_list',
    {
      title: 'List configured repositories',
      description:
        'List every repository registered in this multi-repo workspace, including path and Git status. ' +
        'Use this to discover what other repos exist in this workspace before assuming something isn\'t tracked anywhere.',
      inputSchema: {}
    },
    async () => {
      const config = await loadConfig(cwd);
      return textResult(config.repositories);
    }
  );

  return server;
}

export async function startMcpServer(cwd = process.cwd()): Promise<void> {
  const server = createCtxhubMcpServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
