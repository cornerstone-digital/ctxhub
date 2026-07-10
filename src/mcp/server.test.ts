import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { decode } from '@toon-format/toon';
import { createCtxhubMcpServer } from './server.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

async function withConnectedClient(cwd: string, run: (client: Client) => Promise<void>, opts: { allowIndex?: boolean } = {}) {
  const server = createCtxhubMcpServer(cwd, opts);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-mcp-'));
  try {
    await initConfig('mcp-test-ws', dir);
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await writeFile(path.join(dir, 'app', 'README.md'), '# App\n\n## Authentication flow\n\nAuth details for testing.\n');
    await writeFile(
      path.join(dir, 'app', 'auth.ts'),
      ['export function authenticateRequest(token: string) {', '  return token.length > 0;', '}'].join('\n')
    );

    const config = await loadConfig(dir);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, dir);

    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// textResult() picks whichever of TOON/compact-JSON is smaller per response (src/mcp/compact.ts),
// so tests can't assume either format specifically. JSON.parse is the strict one here -- it
// reliably throws on real TOON text -- so it must be tried first; TOON's decode() is lenient
// enough to "succeed" on plain JSON text with silently wrong results instead of throwing.
function firstTextPayload(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const [first] = result.content;
  assert.equal(first.type, 'text');
  const text = first.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return decode(text);
  }
}

test('mcp server lists the read-only ctxhub tools', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      assert.deepEqual(names, [
        'architecture_map',
        'architecture_search',
        'context_pack',
        'get_file_context',
        'memory_status',
        'open_chunk',
        'repo_list',
        'search',
        'server_status',
        'usage_stats'
      ]);
    })
  );
});

test('mcp usage_stats tool accumulates token-savings estimates as tools are called', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    await withConnectedClient(cwd, async client => {
      const before = firstTextPayload(await client.callTool({ name: 'usage_stats', arguments: {} }) as never) as { totalCalls: number };
      assert.equal(before.totalCalls, 0);

      await client.callTool({ name: 'search', arguments: { query: 'authenticateRequest' } });

      const after = firstTextPayload(await client.callTool({ name: 'usage_stats', arguments: {} }) as never) as {
        totalCalls: number;
        tokensSaved: number;
        tools: Array<{ tool: string; calls: number }>;
      };
      assert.equal(after.totalCalls, 1);
      assert.ok(after.tools.some(t => t.tool === 'search' && t.calls === 1));
    });
  });
});

test('mcp server_status tool reports staleness based on the entry file mtime vs. process start time', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      const result = await client.callTool({ name: 'server_status', arguments: {} });
      const status = firstTextPayload(result as never) as { mode: string; stale: boolean; version: string };
      assert.equal(status.mode, 'dev');
      assert.equal(status.stale, false);
      assert.equal(typeof status.version, 'string');
    })
  );
});

test('mcp mutating index tools are only listed when explicitly enabled', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      assert.ok(names.includes('index_workspace'));
      assert.ok(names.includes('sync_workspace'));
    }, { allowIndex: true })
  );
});

test('mcp repo_list tool returns configured repositories', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      const result = await client.callTool({ name: 'repo_list', arguments: {} });
      const repos = firstTextPayload(result as never) as Array<{ name: string; path: string }>;
      assert.equal(repos.length, 1);
      assert.equal(repos[0].name, 'app');
    })
  );
});

test('mcp search supports result type filters and returns agent follow-up hints', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    await withConnectedClient(cwd, async client => {
      const result = await client.callTool({
        name: 'search',
        arguments: { query: 'authenticateRequest', type: 'code', limit: 5 }
      });
      const payload = firstTextPayload(result as never) as {
        type: string;
        results: Array<{ path?: string; filePath: string; type: string }>;
        localFollowUpCommands: string[];
      };

      assert.equal(payload.type, 'code');
      assert.ok(payload.results.some(item => item.filePath === 'auth.ts' && item.type === 'code'));
      assert.ok(payload.localFollowUpCommands.some(command => command.includes('rg "authenticateRequest" app')));
    });
  });
});

test('mcp server discovers the parent workspace when launched from inside a configured repo', () => {
  return withWorkspace(cwd =>
    withConnectedClient(path.join(cwd, 'app'), async client => {
      const result = await client.callTool({ name: 'repo_list', arguments: {} });
      const repos = firstTextPayload(result as never) as Array<{ name: string; path: string }>;
      assert.equal(repos.length, 1);
      assert.equal(repos[0].name, 'app');

      const fileResult = await client.callTool({
        name: 'get_file_context',
        arguments: { repo: 'app', path: 'README.md', line: 3, mode: 'lines', before: 0, after: 0 }
      });
      const context = firstTextPayload(fileResult as never) as { content: string };
      assert.match(context.content, /Authentication flow/);
    })
  );
});

test('mcp memory_status tool reports provider and index status', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      const result = await client.callTool({ name: 'memory_status', arguments: {} });
      const status = firstTextPayload(result as never) as { memory: { provider: string }; index: { provider: string } };
      assert.equal(status.memory.provider, 'mempalace');
      assert.equal(status.index.provider, 'local-json');
    })
  );
});

test('mcp get_file_context tool defaults to the enclosing function for source files', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      await writeFile(
        path.join(cwd, 'app', 'thing.ts'),
        ['export function outer() {', '  return 1;', '}'].join('\n')
      );

      const result = await client.callTool({
        name: 'get_file_context',
        arguments: { repo: 'app', path: 'thing.ts', line: 2 }
      });
      const context = firstTextPayload(result as never) as { symbol?: { name?: string }; startLine: number; endLine: number };
      assert.equal(context.symbol?.name, 'outer');
      assert.equal(context.startLine, 1);
      assert.equal(context.endLine, 3);
    })
  );
});

test('mcp get_file_context tool mode "lines" bypasses symbol detection', () => {
  return withWorkspace(cwd =>
    withConnectedClient(cwd, async client => {
      await writeFile(
        path.join(cwd, 'app', 'thing.ts'),
        ['export function outer() {', '  return 1;', '}'].join('\n')
      );

      const result = await client.callTool({
        name: 'get_file_context',
        arguments: { repo: 'app', path: 'thing.ts', line: 2, mode: 'lines', before: 0, after: 0 }
      });
      const context = firstTextPayload(result as never) as { symbol?: { name?: string }; startLine: number; endLine: number };
      assert.equal(context.symbol, undefined);
      assert.equal(context.startLine, 2);
      assert.equal(context.endLine, 2);
    })
  );
});
