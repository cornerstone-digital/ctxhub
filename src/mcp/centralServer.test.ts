import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCentralMcpServer } from './centralServer.js';
import { initConfig } from '../config/config.js';
import { registerWorkspace } from '../workspaces/registry.js';

async function withConnectedClient(run: (client: Client) => Promise<void>) {
  const server = createCentralMcpServer();
  const client = new Client({ name: 'test-central-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-central-home-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = ctxhubHome;

  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(ctxhubHome, { recursive: true, force: true });
  }
}

function firstTextPayload(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0];
  return first?.text ? JSON.parse(first.text) : undefined;
}

test('list_workspaces returns an empty list when nothing is registered', () => {
  return withIsolatedCtxhubHome(() =>
    withConnectedClient(async client => {
      const result = await client.callTool({ name: 'list_workspaces', arguments: {} }) as never;
      assert.deepEqual(firstTextPayload(result), { workspaces: [] });
    })
  );
});

test('call_workspace_tool reports a clear error for an unregistered workspace name, without crashing the gateway', () => {
  return withIsolatedCtxhubHome(() =>
    withConnectedClient(async client => {
      const result = await client.callTool({
        name: 'call_workspace_tool',
        arguments: { workspace: 'nonexistent', tool: 'search', arguments: { query: 'anything' } }
      }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };

      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? '', /No registered workspace named "nonexistent"/);
    })
  );
});

test('call_workspace_tool routes a real tool call into the correct registered workspace\'s own isolated MCP server', () => {
  return withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-central-ws-'));
    try {
      await initConfig('central-ws', workspaceDir);
      await mkdir(path.join(workspaceDir, 'app'), { recursive: true });
      await writeFile(path.join(workspaceDir, 'app', 'README.md'), '# App\n\n## Authentication flow\n\nAuth details for testing.\n');

      const { loadConfig, saveConfig } = await import('../config/config.js');
      const config = await loadConfig(workspaceDir);
      config.repositories.push({ name: 'app', path: './app', git: false });
      config.index.provider = 'local-json';
      config.index.path = '.ctxhub/index/local.json';
      await saveConfig(config, workspaceDir);

      const { indexWorkspace } = await import('../indexing/indexer.js');
      await indexWorkspace(workspaceDir);
      await registerWorkspace(workspaceDir, 'central-ws');

      await withConnectedClient(async client => {
        const listResult = await client.callTool({ name: 'list_workspaces', arguments: {} }) as never;
        const listed = firstTextPayload(listResult) as { workspaces: Array<{ name: string }> };
        assert.equal(listed.workspaces.length, 1);
        assert.equal(listed.workspaces[0].name, 'central-ws');

        const searchResult = await client.callTool({
          name: 'call_workspace_tool',
          arguments: { workspace: 'central-ws', tool: 'search', arguments: { query: 'authentication' } }
        }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };

        assert.notEqual(searchResult.isError, true);
        assert.match(searchResult.content[0]?.text ?? '', /Authentication flow/);
      });
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

test('call_workspace_tool reuses the same underlying client for repeated calls to the same workspace', () => {
  return withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-central-reuse-'));
    try {
      await initConfig('reuse-ws', workspaceDir);
      await registerWorkspace(workspaceDir, 'reuse-ws');

      await withConnectedClient(async client => {
        const first = await client.callTool({
          name: 'call_workspace_tool',
          arguments: { workspace: 'reuse-ws', tool: 'server_status', arguments: {} }
        }) as { isError?: boolean };
        const second = await client.callTool({
          name: 'call_workspace_tool',
          arguments: { workspace: 'reuse-ws', tool: 'server_status', arguments: {} }
        }) as { isError?: boolean };

        assert.notEqual(first.isError, true);
        assert.notEqual(second.isError, true);
      });
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
