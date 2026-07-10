import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { createContextPack } from '../context/pack.js';
import { getFileContext } from '../context/fileContext.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { pullRepo } from '../git/git.js';
import { getPackageVersion } from '../utils/version.js';
import { checkServerStaleness } from '../utils/serverStatus.js';
import { SEARCH_FACETS, classifyResult, filterResults, localRgHints, normalizeSearchFacet } from '../context/searchFacets.js';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

async function workspace(cwd: string) {
  return loadWorkspaceConfig(cwd);
}

export function createCtxhubMcpServer(cwd = process.cwd(), opts: { allowIndex?: boolean; startedAt?: number } = {}): McpServer {
  const server = new McpServer({ name: 'ctxhub', version: getPackageVersion() });
  const startedAt = opts.startedAt ?? Date.now();

  server.registerTool(
    'server_status',
    {
      title: 'ctxhub MCP server status',
      description:
        'Report whether THIS running ctxhub MCP server process is stale -- i.e. ctxhub was rebuilt or reinstalled ' +
        'after this process started, so it may be running out-of-date code in memory. Call this if tool results ' +
        'seem to contradict a recent ctxhub change, or once at the start of a long session. If `stale` is true, ' +
        'follow the `instructions` field -- ctxhub cannot restart itself, only the client/harness can.',
      inputSchema: {}
    },
    async () => textResult(checkServerStaleness(startedAt))
  );

  server.registerTool(
    'search',
    {
      title: 'Search workspace knowledge',
      description:
        'Search docs/source across EVERY repo in this multi-repo workspace, including repos other than ' +
        'the one currently open. Use this before answering questions about how another service works, ' +
        'which repo owns a capability, cross-repo integration behavior, or past decisions — anywhere the ' +
        'answer might live outside the current repo. Use type="code" for exact implementation/symbol lookup, ' +
        'type="docs" for README/decision docs, type="architecture" for Mermaid diagrams, and type="notes" for team notes. ' +
        'Returns ranked chunks with repo, path, type, heading, snippet, commit, and local rg follow-up hints.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 5)'),
        type: z.enum(SEARCH_FACETS).optional().describe('Optional result type filter: all, docs, code, architecture, notes')
      }
    },
    async ({ query, limit, type }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
      const facet = normalizeSearchFacet(type);
      const maxResults = limit ?? 5;
      const candidates = await index.search(query, facet === 'all' ? maxResults : Math.max(maxResults * 5, 25));
      const results = filterResults(candidates, facet).slice(0, maxResults);
      return textResult({
        query,
        type: facet,
        resultTypes: countResultTypes(results),
        results: results.map(result => ({ ...result, type: classifyResult(result) })),
        localFollowUpCommands: localRgHints(query, results),
        guidance: [
          'Use ctxhub to orient across repos and identify likely files.',
          'For exact method bodies or edits, follow up with get_file_context or local rg in the target repo.',
          'For architecture/topology questions, prefer type="architecture" or architecture_search.'
        ]
      });
    }
  );

  server.registerTool(
    'context_pack',
    {
      title: 'Assemble context pack',
      description: 'Create an agent-ready bundle for a question: search hits, architecture hits, freshness, repos, status, and suggested reading order.',
      inputSchema: {
        query: z.string().describe('Question or topic'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 8)')
      }
    },
    async ({ query, limit }) => textResult(await createContextPack(query, limit ?? 8, cwd))
  );

  server.registerTool(
    'open_chunk',
    {
      title: 'Open indexed chunk',
      description: 'Return the full indexed chunk/document by id from a prior search or context pack result.',
      inputSchema: {
        id: z.string().describe('Indexed chunk id')
      }
    },
    async ({ id }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
      const document = await index.getDocument(id);
      return textResult(document ?? { error: `Chunk not found: ${id}` });
    }
  );

  server.registerTool(
    'get_file_context',
    {
      title: 'Get file context',
      description:
        'Return surrounding source/doc lines for a repo file. Use after search when a snippet is not enough. ' +
        'For TS/JS/JSX files this defaults to returning the full enclosing function/method/class around `line` ' +
        '(mode "auto"), falling back to a before/after line window when no enclosing symbol is found or the file ' +
        'is not source code. Pass mode "lines" to always use the line window.',
      inputSchema: {
        repo: z.string().describe('Configured repo name'),
        path: z.string().describe('Path within the repo'),
        line: z.number().int().positive().optional().describe('Line to center on (default 1)'),
        before: z.number().int().nonnegative().max(500).optional().describe('Lines before (line-window mode only)'),
        after: z.number().int().nonnegative().max(500).optional().describe('Lines after (line-window mode only)'),
        mode: z.enum(['auto', 'semantic', 'lines']).optional().describe(
          '"auto" (default): full enclosing symbol for source files, else line window. ' +
          '"semantic": same symbol lookup, explicit. "lines": always use before/after line window.'
        )
      }
    },
    async ({ repo, path, line, before, after, mode }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      return textResult(await getFileContext(config, repo, path, { line, before, after, mode }, workspaceRoot));
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
      const { config, workspaceRoot } = await workspace(cwd);
      const memory = createMemoryAdapter(config.memory.provider, config.memory.path, workspaceRoot);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
      const [memoryStatus, indexStatus] = await Promise.all([memory.status(), index.status()]);
      return textResult({ memory: memoryStatus, index: indexStatus });
    }
  );

  if (opts.allowIndex) {
    server.registerTool(
      'index_workspace',
      {
        title: 'Index workspace',
        description: 'Opt-in mutating tool. Re-index changed workspace files. Only available when ctxhub mcp starts with --allow-index.',
        inputSchema: {
          force: z.boolean().optional().describe('Force re-index all files')
        }
      },
      async ({ force }) => textResult(await indexWorkspace(cwd, Boolean(force)))
    );

    server.registerTool(
      'sync_workspace',
      {
        title: 'Sync workspace',
        description: 'Opt-in mutating tool. Pull configured repos then re-index changed files. Only available with --allow-index.',
        inputSchema: {
          noPull: z.boolean().optional().describe('Skip git pull')
        }
      },
      async ({ noPull }) => {
        const { config, workspaceRoot } = await workspace(cwd);
        if (!noPull) {
          for (const repo of config.repositories) {
            await pullRepo(path.resolve(workspaceRoot, repo.path)).catch(() => undefined);
          }
        }
        return textResult(await indexWorkspace(cwd));
      }
    );
  }

  server.registerTool(
    'architecture_search',
    {
      title: 'Search architecture diagrams',
      description:
        'Search indexed Mermaid architecture diagrams and Mermaid blocks. Use this when you need system shape, ' +
        'component relationships, sequence flows, or diagrams before answering architecture questions.',
      inputSchema: {
        query: z.string().describe('Architecture or component query'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 5)')
      }
    },
    async ({ query, limit }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
      const results = (await index.search(`architecture diagram mermaid ${query}`, limit ?? 10))
        .filter(result => result.kind === 'architecture-diagram')
        .slice(0, limit ?? 5);
      return textResult(results);
    }
  );

  server.registerTool(
    'architecture_map',
    {
      title: 'Summarize architecture map',
      description:
        'Return known architecture components and relationships extracted from indexed Mermaid diagrams. ' +
        'Use this before drawing conclusions about service topology or cross-repo dependencies.',
      inputSchema: {
        query: z.string().optional().describe('Optional component or repo filter')
      }
    },
    async ({ query }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
      const results = (await index.search(query ? `architecture diagram mermaid ${query}` : 'architecture diagram mermaid', 50))
        .filter(result => result.kind === 'architecture-diagram');
      const components = [...new Set(results.flatMap(result => result.components ?? []))].sort();
      const relationships = [...new Set(results.flatMap(result => result.relationships ?? []))].sort();
      return textResult({
        diagrams: results.map(result => ({
          id: result.id,
          repo: result.repo,
          path: result.filePath,
          title: result.title,
          diagramType: result.diagramType,
          commit: result.commit
        })),
        components,
        relationships
      });
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
      const { config } = await workspace(cwd);
      return textResult(config.repositories);
    }
  );

  return server;
}

function countResultTypes(results: Array<Parameters<typeof classifyResult>[0]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const type = classifyResult(result);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export async function startMcpServer(cwd = process.cwd(), opts: { allowIndex?: boolean } = {}): Promise<void> {
  const server = createCtxhubMcpServer(cwd, opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
