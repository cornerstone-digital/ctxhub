import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCtxhubMcpServer } from './server.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';

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

    const config = await loadConfig(dir);
    config.repositories.push({ name: 'app', path: './app', git: false });
    await saveConfig(config, dir);

    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function firstTextPayload(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const [first] = result.content;
  assert.equal(first.type, 'text');
  return JSON.parse(first.text ?? '');
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
        'search'
      ]);
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
      assert.equal(status.index.provider, 'lancedb');
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
