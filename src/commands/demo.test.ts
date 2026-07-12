import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { demoCommand } from './demo.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { isGitRepo } from '../git/git.js';
import { loadKnowledgeStore } from '../knowledge/store.js';
import { loadCaptainTasks } from '../captains/tasks.js';
import { listCaptainRuns } from '../captains/runner.js';
import { loadGroupStore } from '../groups/store.js';
import { readEventLog } from '../events/eventLog.js';
import { readUsageStats } from '../utils/usageStats.js';
import { saveCaptainTasks } from '../captains/tasks.js';
import { saveGroupStore } from '../groups/store.js';
import { loadScimStore, saveScimStore } from '../scim/store.js';
import { loadMachineTokenStore, saveMachineTokenStore } from '../auth/machineTokenStore.js';
import { findInstalled } from '../blueprints/store.js';

async function withIsolatedHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-demo-cmd-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = home;
  try {
    await run(home);
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(home, { recursive: true, force: true });
  }
}

test('demoCommand indexes multiple chunks per file, not one chunk per file', () => {
  return withIsolatedHome(async home => {
    await demoCommand();

    const demoRoot = path.join(home, 'demo-workspace');
    const { config, workspaceRoot } = await loadWorkspaceConfig(demoRoot);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
    const chunks = await index.recent(10_000);

    // Regression: the summary line used to report indexWorkspace()'s file count
    // mislabeled as a chunk count. Files split into headed sections produce far
    // more than one chunk each, so this must be strictly greater than the file count.
    assert.ok(chunks.length > 6, `expected more than 6 chunks (one per file), got ${chunks.length}`);
  });
});

test('demoCommand initialises demo-docs as a git repo so `repo hook` works', () => {
  return withIsolatedHome(async home => {
    await demoCommand();

    const demoRoot = path.join(home, 'demo-workspace');
    assert.equal(await isGitRepo(demoRoot), true);
  });
});

test('demoCommand seeds a repeatable, populated Mission Control scenario', () => {
  return withIsolatedHome(async home => {
    await saveCaptainTasks({ version: 1, tasks: [{ name: 'user-task', workspace: 'somewhere-else', query: 'Preserve me' }] });
    await saveGroupStore({ version: 1, groups: [{ id: 'user-group', name: 'User Group', createdAt: new Date().toISOString(), createdBy: 'user' }], orgs: [], sharingPolicies: [] });
    const userScim = await loadScimStore();
    await saveScimStore({ ...userScim, users: [...userScim.users, { id: 'user-scim', userName: 'user@example.com', active: true, meta: { resourceType: 'User', created: new Date().toISOString(), lastModified: new Date().toISOString(), location: '/scim/v2/Users/user-scim' } }] });
    const userTokens = await loadMachineTokenStore();
    await saveMachineTokenStore({ ...userTokens, tokens: [...userTokens.tokens, { id: 'user-token', name: 'user-ci', hashedToken: 'irrelevant', roles: ['machine'], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }] });

    await demoCommand();
    const demoRoot = path.join(home, 'demo-workspace');
    const knowledge = await loadKnowledgeStore('ctxhub-demo');
    assert.equal(knowledge.objects.length, 4);
    assert.ok(knowledge.edges.length > 0);
    assert.equal((await loadCaptainTasks()).tasks.length, 4);
    assert.equal((await listCaptainRuns('architecture-review')).total, 1);
    assert.equal((await loadGroupStore()).orgs.length, 3);
    assert.ok((await loadGroupStore()).groups.some(group => group.id === 'user-group'));
    assert.equal((await readEventLog({ limit: 100 })).length, 6);
    assert.equal(Object.keys((await readUsageStats(path.join(demoRoot, '.ctxhub', 'stats.json')))?.daily ?? {}).length, 14);

    const scimAfterFirstSeed = await loadScimStore();
    assert.equal(scimAfterFirstSeed.users.filter(u => u.id.startsWith('demo-scim')).length, 2);
    assert.ok(scimAfterFirstSeed.users.some(u => u.id === 'user-scim'));
    const tokensAfterFirstSeed = await loadMachineTokenStore();
    assert.ok(tokensAfterFirstSeed.tokens.some(t => t.name === 'demo-ci'));
    assert.ok(tokensAfterFirstSeed.tokens.some(t => t.id === 'user-token'));
    assert.ok(await findInstalled('secure-service-launch'));

    await demoCommand({ force: true });
    assert.equal((await loadKnowledgeStore('ctxhub-demo')).objects.length, 4);
    assert.equal((await listCaptainRuns('architecture-review')).total, 1);
    assert.ok((await loadCaptainTasks()).tasks.some(task => task.name === 'user-task'));
    const scimAfterReseed = await loadScimStore();
    assert.equal(scimAfterReseed.users.filter(u => u.id.startsWith('demo-scim')).length, 2);
    assert.ok(scimAfterReseed.users.some(u => u.id === 'user-scim'));
    const tokensAfterReseed = await loadMachineTokenStore();
    assert.equal(tokensAfterReseed.tokens.filter(t => t.name === 'demo-ci').length, 1);
  });
});
