import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadWorkspaceConfig, STATS_PATH } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { addDrawerMempalace, readMempalaceStatusSummary, searchMempalace, timelineMempalace, writeDiaryMempalace } from '../memory/mempalaceCli.js';
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
import { createGroup, addOrg, updateSharing } from '../groups/groups.js';
import { loadGroupStore, findGroup, findOrgsByGroup, getEffectiveSharing } from '../groups/store.js';
import type { SharingMode } from '../groups/types.js';
import { meetsMinTrustTier, TRUST_TIER_ORDER } from '../indexing/chunk.js';
import type { ChunkTrustTier } from '../indexing/chunk.js';
import type { IndexedDocument } from '../config/types.js';

// The one choke point every tool response passes through -- compaction (dropping redundant
// full content, picking TOON vs. JSON per payload) happens here so individual tool handlers
// never need to know or care about it.
function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: compactEncode(value) }] };
}

async function workspace(cwd: string) {
  try {
    return await loadWorkspaceConfig(cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNotFound = /ENOENT|no such file|not found|cannot find/i.test(message);
    throw new Error(
      isNotFound
        ? `No ctxhub workspace found at ${cwd}. Run: ctxhub init`
        : `Failed to load ctxhub config: ${message}`,
      { cause: error }
    );
  }
}

function toolError(message: string): ReturnType<typeof textResult> {
  return textResult({ error: message });
}

// Best-effort telemetry backing the `usage_stats` tool/`ctxhub stats` command: records how many
// tokens a tool call returned vs. the heuristic cost of reading every distinct matched file in
// full, so agents/users can see roughly how much ctxhub's targeted retrieval is saving over time.
// Measures the same compacted text textResult() actually sends, not the raw pre-compaction JSON,
// so the savings number reflects what the agent really received.
// Best-effort telemetry: awaited so stats are visible to the same session's `usage_stats` call,
// but failures (disk full, missing dir, permissions) are swallowed so they NEVER propagate to
// the tool caller. Telemetry is a bonus, not a requirement for the tool to return useful results.
async function recordUsage(workspaceRoot: string, tool: string, payload: unknown, absolutePaths: Array<string | undefined>): Promise<void> {
  const tokensReturned = estimateTokens(compactEncode(payload));
  const tokensBaseline = estimateBaselineTokensFromFileSizes(absolutePaths);
  await recordToolUsage(path.join(workspaceRoot, STATS_PATH), tool, tokensReturned, tokensBaseline).catch(() => undefined);
}

export function createCtxhubMcpServer(
  cwd = process.cwd(),
  opts: {
    allowIndex?: boolean;
    allowMemoryWrite?: boolean;
    startedAt?: number;
    runAgentPromptFn?: typeof runAgentPrompt;
    readMempalaceStatusSummaryFn?: typeof readMempalaceStatusSummary;
    searchMempalaceFn?: typeof searchMempalace;
    timelineMempalaceFn?: typeof timelineMempalace;
    addDrawerMempalaceFn?: typeof addDrawerMempalace;
    writeDiaryMempalaceFn?: typeof writeDiaryMempalace;
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
      try {
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
      } catch (error) {
        return toolError(`search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      try {
        const pack = await createContextPack(query, limit ?? 8, cwd, { maxTokens });
        const { workspaceRoot } = await workspace(cwd);
        await recordUsage(workspaceRoot, 'context_pack', pack, [...pack.search, ...pack.architecture].map(result => result.absolutePath));
        return textResult(pack);
      } catch (error) {
        return toolError(`context_pack failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      try {
        const { config, workspaceRoot } = await workspace(cwd);
        const repoConfig = config.repositories.find(candidate => candidate.name === repo);
        if (!repoConfig) {
          const known = config.repositories.map(r => r.name).join(', ') || 'none configured';
          return toolError(`Unknown repo: '${repo}'. Known repos: ${known}. Run: ctxhub repo list`);
        }
        const context = await getFileContext(config, repo, filePath, { line, before, after, mode }, workspaceRoot);
        const absolutePath = path.resolve(workspaceRoot, repoConfig.path, filePath);
        await recordUsage(workspaceRoot, 'get_file_context', context, [absolutePath]);
        return textResult(context);
      } catch (error) {
        return toolError(`get_file_context failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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

  // A separate opt-in gate from --allow-index: writing to durable MemPalace memory is a
  // different kind of mutation than re-indexing this workspace's own content, so allowing one
  // shouldn't silently allow the other. Thin passthroughs to the same ctxhub memory add/diary
  // CLI commands -- not a second memory implementation, see ROADMAP.md's "Not planned" section.
  if (opts.allowMemoryWrite) {
    server.registerTool(
      'memory_add',
      {
        title: 'Add durable MemPalace memory',
        description:
          'Opt-in mutating tool. File a durable memory drawer in MemPalace (not the repo/source index). Only ' +
          'available when ctxhub mcp starts with --allow-memory-write. Thin passthrough to `ctxhub memory add`.',
        inputSchema: {
          content: z.string().describe('The memory content to store'),
          wing: z.string().describe('MemPalace wing/project to file this under'),
          room: z.string().describe('MemPalace room within the wing'),
          source_file: z.string().optional().describe('Optional source file this memory relates to'),
          added_by: z.string().optional().describe('Optional attribution (default: ctxhub-memory-add)')
        }
      },
      async ({ content, wing, room, source_file, added_by }) => {
        const { config, workspaceRoot } = await workspace(cwd);
        const result = await (opts.addDrawerMempalaceFn ?? addDrawerMempalace)(config, workspaceRoot, {
          wing,
          room,
          content,
          sourceFile: source_file,
          addedBy: added_by
        });
        return textResult(result);
      }
    );

    server.registerTool(
      'diary_write',
      {
        title: 'Write a MemPalace diary entry',
        description:
          'Opt-in mutating tool. Write a diary-style session note to MemPalace. Only available when ctxhub mcp ' +
          'starts with --allow-memory-write. Thin passthrough to `ctxhub memory diary`.',
        inputSchema: {
          entry: z.string().describe('The diary entry content'),
          agent_name: z.string().describe('Name of the agent writing this entry'),
          topic: z.string().optional().describe('Optional topic label (default: general)'),
          wing: z.string().optional().describe('Optional MemPalace wing/project to scope this to')
        }
      },
      async ({ entry, agent_name, topic, wing }) => {
        const { config, workspaceRoot } = await workspace(cwd);
        const result = await (opts.writeDiaryMempalaceFn ?? writeDiaryMempalace)(config, workspaceRoot, {
          agentName: agent_name,
          entry,
          topic,
          wing
        });
        return textResult(result);
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

  // ── Corporate Group tools ─────────────────────────────────────────────────

  server.registerTool(
    'group_list',
    {
      title: 'List corporate groups',
      description:
        'List all corporate groups with their member organisations. Use this to understand the cross-org knowledge ' +
        'topology — which organisations exist, which group they belong to, and their peer URLs.',
      inputSchema: {}
    },
    async () => {
      try {
        const store = await loadGroupStore();
        const result = store.groups.map(group => ({
          ...group,
          orgs: store.orgs.filter(o => o.groupId === group.id),
        }));
        return textResult(result);
      } catch (error) {
        return toolError(`group_list failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  server.registerTool(
    'group_create',
    {
      title: 'Create a corporate group',
      description: 'Create a new corporate group. Groups are the top-level container for multiple organisations that share knowledge under a common parent entity.',
      inputSchema: {
        name: z.string().describe('Human-readable name for the group (e.g. "VodafoneThree UK")'),
        created_by: z.string().optional().describe('Identity of the creator (default: mcp-agent)')
      }
    },
    async ({ name, created_by }) => {
      try {
        const group = await createGroup(name, created_by ?? 'mcp-agent');
        return textResult(group);
      } catch (error) {
        return toolError(`group_create failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  server.registerTool(
    'group_add_org',
    {
      title: 'Add an organisation to a group',
      description: 'Add an organisation to an existing corporate group. Each org has a tenantId (Entra tenant) and an optional peer URL for cross-org search fan-out.',
      inputSchema: {
        groupId: z.string().describe('ID of the corporate group to add the org to'),
        name: z.string().describe('Human-readable name for the organisation (e.g. "Vodafone UK Engineering")'),
        tenantId: z.string().describe('Microsoft Entra tenant ID for this organisation'),
        peerUrl: z.string().optional().describe('Optional base URL of this org\'s ctxhub service for cross-org search fan-out'),
        added_by: z.string().optional().describe('Identity of the operator adding this org (default: mcp-agent)')
      }
    },
    async ({ groupId, name, tenantId, peerUrl, added_by }) => {
      try {
        const org = await addOrg(groupId, { name, tenantId, peerUrl }, added_by ?? 'mcp-agent');
        return textResult(org);
      } catch (error) {
        return toolError(`group_add_org failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  server.registerTool(
    'group_sharing',
    {
      title: 'Update sharing between organisations',
      description:
        'Set the sharing mode between two organisations. ' +
        '"read" means fromOrg can search toOrg\'s knowledge but not vice versa. ' +
        '"bidirectional" means both can search each other. ' +
        '"none" removes all sharing between the two orgs.',
      inputSchema: {
        fromOrgId: z.string().describe('ID of the organisation that will have read access'),
        toOrgId: z.string().describe('ID of the organisation whose knowledge will be shared'),
        mode: z.enum(['none', 'read', 'bidirectional']).describe('Sharing mode'),
        updated_by: z.string().optional().describe('Identity of the operator making this change (default: mcp-agent)')
      }
    },
    async ({ fromOrgId, toOrgId, mode, updated_by }) => {
      try {
        const policy = await updateSharing(fromOrgId, toOrgId, mode as SharingMode, updated_by ?? 'mcp-agent');
        return textResult(policy);
      } catch (error) {
        return toolError(`group_sharing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  server.registerTool(
    'group_status',
    {
      title: 'Get full group topology',
      description:
        'Return the full topology for a specific group: the group metadata, all member organisations, ' +
        'and the sharing matrix (who can read whose knowledge). Use this before answering questions about ' +
        'cross-org knowledge access or group membership.',
      inputSchema: {
        groupId: z.string().describe('ID of the corporate group')
      }
    },
    async ({ groupId }) => {
      try {
        const store = await loadGroupStore();
        const group = findGroup(store, groupId);
        if (!group) {
          return toolError(`No group with id "${groupId}"`);
        }
        const orgs = findOrgsByGroup(store, groupId);
        const sharingMatrix = orgs.flatMap(from =>
          orgs
            .filter(to => to.id !== from.id)
            .map(to => ({
              fromOrgId: from.id,
              fromOrgName: from.name,
              toOrgId: to.id,
              toOrgName: to.name,
              mode: getEffectiveSharing(store, from.id, to.id),
            }))
        );
        return textResult({ group, orgs, sharingMatrix });
      } catch (error) {
        return toolError(`group_status failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ── Chunk trust tier tools ────────────────────────────────────────────────

  server.registerTool(
    'chunk_promote',
    {
      title: 'Promote a chunk to a higher trust tier',
      description:
        'Elevate a specific chunk to "institutional" or "canonical" trust tier so cross-org search and ' +
        'trust-filtered queries prefer it. Pass the chunk id (full or prefix), the target tier, and an ' +
        'optional reason and promotedBy attribution. Returns the updated chunk id and tier on success.',
      inputSchema: {
        chunkId: z.string().describe('Full chunk id or unambiguous prefix from a prior search result'),
        tier: z.enum(['institutional', 'canonical']).describe('Target trust tier to promote to'),
        reason: z.string().optional().describe('Optional human-readable reason for the promotion'),
        promotedBy: z.string().optional().describe('Identity of the agent or user performing the promotion (default: mcp-agent)')
      }
    },
    async ({ chunkId, tier, reason, promotedBy }) => {
      try {
        const { config, workspaceRoot } = await workspace(cwd);
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);

        // Resolve full id from prefix
        const exact = await index.getDocument(chunkId);
        let chunk: IndexedDocument | undefined = exact;
        if (!chunk && chunkId.length >= 8) {
          const all = await index.recent(10_000);
          const matches = all.filter(c => c.id.startsWith(chunkId));
          if (matches.length > 1) {
            return toolError(`Chunk id prefix is ambiguous: "${chunkId}". Matches: ${matches.map(m => m.id.slice(0, 12)).join(', ')}`);
          }
          chunk = matches[0];
        }

        if (!chunk) return toolError(`Chunk not found: ${chunkId}`);

        const updated: IndexedDocument = {
          ...chunk,
          trustTier: tier as ChunkTrustTier,
          promotedAt: new Date().toISOString(),
          promotedBy: promotedBy ?? 'mcp-agent',
          ...(reason ? { promotionReason: reason } : {})
        };

        await index.indexDocuments([updated]);
        return textResult({ success: true, chunkId: chunk.id, tier });
      } catch (error) {
        return toolError(`chunk_promote failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  server.registerTool(
    'chunk_list_promoted',
    {
      title: 'List chunks at or above a trust tier',
      description:
        'Return chunks whose trust tier is at or above the specified minimum. Use this to discover what ' +
        'knowledge has been promoted to institutional or canonical quality, or to audit the trust tier ' +
        'distribution across the workspace index.',
      inputSchema: {
        minTier: z.enum(['reviewed', 'promoted', 'institutional', 'canonical']).describe('Minimum trust tier to include in results')
      }
    },
    async ({ minTier }) => {
      try {
        const { config, workspaceRoot } = await workspace(cwd);
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
        const all = await index.recent(10_000);
        const minTierValue = minTier as ChunkTrustTier;
        if (!TRUST_TIER_ORDER.includes(minTierValue)) {
          return toolError(`Invalid minTier: "${minTier}". Must be one of: ${TRUST_TIER_ORDER.join(', ')}`);
        }
        const matching = all.filter(chunk => meetsMinTrustTier(chunk, minTierValue));
        return textResult({
          chunks: matching.map(chunk => ({
            id: chunk.id,
            trustTier: chunk.trustTier ?? 'unverified',
            title: chunk.title ?? chunk.filePath,
            repo: chunk.repo
          }))
        });
      } catch (error) {
        return toolError(`chunk_list_promoted failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ── Cloud sync tools ──────────────────────────────────────────────────────

  server.tool(
    'cloud_sync',
    'Trigger a sync of promoted (institutional/canonical) chunks from the current workspace to ctxhub Cloud. ' +
    'Returns how many chunks were synced and any errors encountered.',
    {},
    async () => {
      try {
        const { getSyncConfig, syncToCloud } = await import('../cloud/sync.js');
        const syncConfig = await getSyncConfig();
        if (!syncConfig) {
          return textResult({ synced: 0, skipped: true, errors: ['Cloud sync not configured. Run: ctxhub cloud configure'] });
        }
        const { config, workspaceRoot } = await workspace(cwd);
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
        const all = await index.recent(10_000);
        const result = await syncToCloud(syncConfig, all);
        return textResult({
          synced: result.synced ?? 0,
          skipped: result.skipped ?? false,
          errors: result.errors ?? [],
        });
      } catch (error) {
        return toolError(`cloud_sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  server.tool(
    'cloud_status',
    'Return current cloud sync configuration and last sync info for this ctxhub instance.',
    {},
    async () => {
      try {
        const { loadCloudConfig } = await import('../commands/cloud.js');
        const cloudConfig = await loadCloudConfig();
        if (!cloudConfig) {
          const { config, workspaceRoot } = await workspace(cwd);
          const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
          const all = await index.recent(10_000);
          const available = all.filter(c => c.trustTier === 'institutional' || c.trustTier === 'canonical').length;
          return textResult({ configured: false, chunksAvailable: available });
        }
        const endpoint = cloudConfig.endpoint;
        const { config, workspaceRoot } = await workspace(cwd);
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
        const all = await index.recent(10_000);
        const available = all.filter(c => c.trustTier === 'institutional' || c.trustTier === 'canonical').length;
        return textResult({
          configured: true,
          endpoint: endpoint.length > 20 ? `${endpoint.slice(0, 20)}…` : endpoint,
          lastSync: cloudConfig.lastSyncAt ?? null,
          chunksAvailable: available,
        });
      } catch (error) {
        return toolError(`cloud_status failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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

export async function startMcpServer(cwd = process.cwd(), opts: { allowIndex?: boolean; allowMemoryWrite?: boolean; restartOnStale?: boolean } = {}): Promise<void> {
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
