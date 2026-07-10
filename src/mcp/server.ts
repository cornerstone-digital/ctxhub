import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadWorkspaceConfig, STATS_PATH } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { readMempalaceStatusSummary, searchMempalace, timelineMempalace } from '../memory/mempalaceCli.js';
import { createContextPack } from '../context/pack.js';
import { getFileContext } from '../context/fileContext.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { pullRepo } from '../git/git.js';
import { getPackageVersion } from '../utils/version.js';
import { checkServerStaleness } from '../utils/serverStatus.js';
import { estimateTokens, trimToTokenBudget } from '../utils/tokenEstimate.js';
import { estimateBaselineTokensFromFileSizes, readUsageStats, recordToolUsage, summarizeUsageStats } from '../utils/usageStats.js';
import { SEARCH_FACETS, classifyResult, filterResults, localRgHints, normalizeSearchFacet } from '../context/searchFacets.js';
import { maybeRewriteSearchInput } from '../commands/search.js';
import { runAgentPrompt } from '../llm/runAgent.js';
import { compactEncode } from './compact.js';

// The one choke point every tool response passes through -- compaction (dropping redundant
// full content, picking TOON vs. JSON per payload) happens here so individual tool handlers
// never need to know or care about it.
function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: compactEncode(value) }] };
}

async function workspace(cwd: string) {
  return loadWorkspaceConfig(cwd);
}

// Best-effort telemetry backing the `usage_stats` tool/`ctxhub stats` command: records how many
// tokens a tool call returned vs. the heuristic cost of reading every distinct matched file in
// full, so agents/users can see roughly how much ctxhub's targeted retrieval is saving over time.
// Measures the same compacted text textResult() actually sends, not the raw pre-compaction JSON,
// so the savings number reflects what the agent really received.
async function recordUsage(workspaceRoot: string, tool: string, payload: unknown, absolutePaths: Array<string | undefined>) {
  const tokensReturned = estimateTokens(compactEncode(payload));
  const tokensBaseline = estimateBaselineTokensFromFileSizes(absolutePaths);
  await recordToolUsage(path.join(workspaceRoot, STATS_PATH), tool, tokensReturned, tokensBaseline);
}

export function createCtxhubMcpServer(
  cwd = process.cwd(),
  opts: {
    allowIndex?: boolean;
    startedAt?: number;
    runAgentPromptFn?: typeof runAgentPrompt;
    readMempalaceStatusSummaryFn?: typeof readMempalaceStatusSummary;
    searchMempalaceFn?: typeof searchMempalace;
    timelineMempalaceFn?: typeof timelineMempalace;
  } = {}
): McpServer {
  const server = new McpServer({ name: 'ctxhub', version: getPackageVersion() });
  const startedAt = opts.startedAt ?? Date.now();

  // Tracks chunk ids already returned by `search` on this running process, backing
  // `excludeSeen` so overlapping/repeat queries in one long session don't re-ship the same
  // content. Deliberately in-memory only -- it only needs to survive one server process, not
  // across restarts, so there's no need for MemPalace/disk persistence here.
  const seenChunkIds = new Set<string>();

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
        'Returns ranked chunks with repo, path, type, heading, snippet, commit, and local rg follow-up hints. ' +
        'Optional maxTokens caps total response size by token budget rather than item count alone. Optional ' +
        'excludeSeen skips chunks this same connection already returned earlier in the session, so overlapping ' +
        'follow-up queries do not re-ship content already in your context.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 5)'),
        type: z.enum(SEARCH_FACETS).optional().describe('Optional result type filter: all, docs, code, architecture, notes'),
        rewriteQuery: z.boolean().optional().describe('Ask the configured agent CLI to rewrite the query/type before searching; when it changes, both original and rewritten values are returned'),
        maxTokens: z.number().int().positive().optional().describe('Optional token budget; lower-ranked results are dropped (by id) to fit'),
        excludeSeen: z.boolean().optional().describe('Skip chunks already returned by search earlier in this session (default false)')
      }
    },
    async ({ query, limit, type, rewriteQuery, maxTokens, excludeSeen }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
      const facet = normalizeSearchFacet(type);
      const rewritten = rewriteQuery
        ? await maybeRewriteSearchInput(query, facet, config, opts.runAgentPromptFn ?? runAgentPrompt)
        : { query, facet };
      const maxResults = limit ?? 5;
      // Facet 'all' normally doesn't need a wider candidate pool since nothing gets filtered out
      // afterward -- but excludeSeen filters the pool too, so it needs headroom beyond maxResults
      // even here, or there's nothing left to backfill with once already-seen ids are skipped.
      const candidatePoolSize = rewritten.facet === 'all' && !excludeSeen ? maxResults : Math.max(maxResults * 5, 25);
      const candidates = await index.search(rewritten.query, candidatePoolSize);
      const facetFiltered = filterResults(candidates, rewritten.facet);
      const unseen = excludeSeen ? facetFiltered.filter(result => !seenChunkIds.has(result.id)) : facetFiltered;
      const filtered = unseen.slice(0, maxResults);
      const { kept: results, droppedIds } = maxTokens !== undefined ? trimToTokenBudget(filtered, maxTokens) : { kept: filtered, droppedIds: [] as string[] };
      for (const result of results) seenChunkIds.add(result.id);
      const payload = {
        query: rewritten.query,
        type: rewritten.facet,
        resultTypes: countResultTypes(results),
        results: results.map(result => ({ ...result, type: classifyResult(result) })),
        localFollowUpCommands: localRgHints(rewritten.query, results),
        guidance: [
          'Use ctxhub to orient across repos and identify likely files.',
          'For exact method bodies or edits, follow up with get_file_context or local rg in the target repo.',
          'For architecture/topology questions, prefer type="architecture" or architecture_search.'
        ],
        ...(rewritten.rewritten ? { originalQuery: query, originalType: facet, rewrittenQuery: rewritten.query, rewrittenType: rewritten.facet } : {}),
        ...(rewritten.notice ? { llmNotice: rewritten.notice } : {}),
        ...(droppedIds.length ? { droppedIds } : {})
      };
      await recordUsage(workspaceRoot, 'search', payload, results.map(result => result.absolutePath));
      return textResult(payload);
    }
  );

  server.registerTool(
    'context_pack',
    {
      title: 'Assemble context pack',
      description:
        'Create an agent-ready bundle for a question: search hits, architecture hits, freshness, repos, status, and ' +
        'suggested reading order. Optional maxTokens caps the search section by token budget rather than item count alone.',
      inputSchema: {
        query: z.string().describe('Question or topic'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 8)'),
        maxTokens: z.number().int().positive().optional().describe('Optional token budget for the search section; lower-ranked results are dropped (by id) to fit')
      }
    },
    async ({ query, limit, maxTokens }) => {
      const pack = await createContextPack(query, limit ?? 8, cwd, { maxTokens });
      const { workspaceRoot } = await workspace(cwd);
      await recordUsage(workspaceRoot, 'context_pack', pack, [...pack.search, ...pack.architecture].map(result => result.absolutePath));
      return textResult(pack);
    }
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
      const payload = document ?? { error: `Chunk not found: ${id}` };
      if (document) await recordUsage(workspaceRoot, 'open_chunk', payload, [document.absolutePath]);
      return textResult(payload);
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
    async ({ repo, path: filePath, line, before, after, mode }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const context = await getFileContext(config, repo, filePath, { line, before, after, mode }, workspaceRoot);
      const repoConfig = config.repositories.find(candidate => candidate.name === repo);
      const absolutePath = repoConfig ? path.resolve(workspaceRoot, repoConfig.path, filePath) : undefined;
      await recordUsage(workspaceRoot, 'get_file_context', context, [absolutePath]);
      return textResult(context);
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
      const [memoryStatus, indexStatus, memorySummary] = await Promise.all([
        memory.status(),
        index.status(),
        (opts.readMempalaceStatusSummaryFn ?? readMempalaceStatusSummary)(config, workspaceRoot)
      ]);
      return textResult({ memory: memoryStatus, index: indexStatus, memorySummary });
    }
  );

  server.registerTool(
    'memory_search',
    {
      title: 'Search durable MemPalace memory',
      description:
        'Search durable MemPalace memory rather than the repo/source index. Use this for past decisions, prior sessions, or ' +
        'personal durable memory that is intentionally not stored in git-tracked docs. Optional wing/room/source_file filters ' +
        'let you scope the search to a project or topic area.',
      inputSchema: {
        query: z.string().describe('Memory search query'),
        limit: z.number().int().positive().max(50).optional().describe('Max results (default 5)'),
        wing: z.string().optional().describe('Optional MemPalace wing/project filter'),
        room: z.string().optional().describe('Optional MemPalace room filter'),
        source_file: z.string().optional().describe('Optional exact stored source file filter')
      }
    },
    async ({ query, limit, wing, room, source_file }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const result = await (opts.searchMempalaceFn ?? searchMempalace)(config, workspaceRoot, {
        query,
        limit,
        wing,
        room,
        sourceFile: source_file
      });
      await recordUsage(workspaceRoot, 'memory_search', result, result.results?.map(hit => hit.source_path) ?? []);
      return textResult(result);
    }
  );

  server.registerTool(
    'memory_timeline',
    {
      title: 'Read MemPalace knowledge-graph timeline',
      description:
        'Return chronological MemPalace knowledge-graph facts, optionally focused on one entity. Use this when the user wants ' +
        'how a topic evolved over time rather than just matching memory hits.',
      inputSchema: {
        entity: z.string().optional().describe('Optional entity to focus the timeline on')
      }
    },
    async ({ entity }) => {
      const { config, workspaceRoot } = await workspace(cwd);
      const result = await (opts.timelineMempalaceFn ?? timelineMempalace)(config, workspaceRoot, { entity });
      return textResult(result);
    }
  );

  server.registerTool(
    'usage_stats',
    {
      title: 'ctxhub token savings stats',
      description:
        'Report how much ctxhub\'s targeted search/context tools have saved versus reading full files directly, ' +
        'accumulated across every call in this workspace. Tokens are a heuristic estimate (chars/4); the baseline ' +
        'assumes the agent would otherwise have read each distinct matched file in full. Call this if the user asks ' +
        'how much ctxhub is helping, or wants to see its ROI.',
      inputSchema: {}
    },
    async () => {
      const { workspaceRoot } = await workspace(cwd);
      const stats = await readUsageStats(path.join(workspaceRoot, STATS_PATH));
      return textResult(summarizeUsageStats(stats));
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
      await recordUsage(workspaceRoot, 'architecture_search', results, results.map(result => result.absolutePath));
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
      const payload = {
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
      };
      await recordUsage(workspaceRoot, 'architecture_map', payload, results.map(result => result.absolutePath));
      return textResult(payload);
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

// How often to poll for a newer build once --restart-on-stale is enabled. Staleness only
// changes on a rebuild/reinstall, so this doesn't need to be tight -- a stat() call is cheap
// either way, but there's no reason to spend more of it than a minute's worth of latency.
const STALE_POLL_MS = 60_000;

export async function startMcpServer(cwd = process.cwd(), opts: { allowIndex?: boolean; restartOnStale?: boolean } = {}): Promise<void> {
  const startedAt = Date.now();
  const server = createCtxhubMcpServer(cwd, { ...opts, startedAt });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const bootStatus = checkServerStaleness(startedAt);
  console.error(
    `[ctxhub] MCP server started -- version ${bootStatus.version}, mode ${bootStatus.mode}` +
      (bootStatus.builtAt ? `, built ${bootStatus.builtAt}` : '')
  );

  if (opts.restartOnStale) {
    // ctxhub can't force its host to relaunch it -- exiting only achieves an effective restart
    // if the host auto-respawns a stopped stdio MCP server. Where it doesn't, this just ends the
    // connection, so it's opt-in rather than the default behavior.
    setInterval(() => {
      if (checkServerStaleness(startedAt).stale) {
        console.error(
          '[ctxhub] Detected a newer build on disk -- exiting so the host can relaunch with current code. ' +
            'If your MCP host does not auto-restart a stopped server, reconnect it manually.'
        );
        process.exit(0);
      }
    }, STALE_POLL_MS).unref();
  }
}
