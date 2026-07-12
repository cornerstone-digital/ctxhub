import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { initConfig, loadWorkspaceConfig, saveConfig } from '../config/config.js';
import { registerWorkspace } from '../workspaces/registry.js';
import { loadScimStore, saveScimStore } from '../scim/store.js';
import { loadMachineTokenStore, saveMachineTokenStore, generateRawToken, hashToken } from '../auth/machineTokenStore.js';
import { eventBus } from '../events/eventBus.js';
import { computeUsageReport } from './usage.js';

async function withIsolatedCtxhubHome(run: () => Promise<void>): Promise<void> {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-billing-usage-home-'));
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

test('computeUsageReport counts SCIM seats, workspace role overrides, and active machine tokens', () =>
  withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-billing-usage-ws-'));
    try {
      await initConfig('billing-ws', workspaceDir);
      await registerWorkspace(workspaceDir, 'billing-ws');

      const { config, workspaceRoot } = await loadWorkspaceConfig(workspaceDir);
      config.workspace.memberOverrides = { 'user-1': 'admin', 'user-2': 'member' };
      await saveConfig(config, workspaceRoot);

      const scimStore = await loadScimStore();
      scimStore.users.push(
        {
          id: 'scim-1', userName: 'alice@example.com', active: true,
          meta: { resourceType: 'User', created: '2026-01-01T00:00:00Z', lastModified: '2026-01-01T00:00:00Z', location: '/scim/v2/Users/scim-1' },
        },
        {
          id: 'scim-2', userName: 'bob@example.com', active: false,
          meta: { resourceType: 'User', created: '2026-01-01T00:00:00Z', lastModified: '2026-01-01T00:00:00Z', location: '/scim/v2/Users/scim-2' },
        },
      );
      await saveScimStore(scimStore);

      const tokenStore = await loadMachineTokenStore();
      const raw = generateRawToken();
      tokenStore.tokens.push({
        id: 'mt-1', name: 'ci', hashedToken: await hashToken(raw), roles: ['machine'],
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      tokenStore.tokens.push({
        id: 'mt-2', name: 'expired', hashedToken: await hashToken(generateRawToken()), roles: ['machine'],
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
      await saveMachineTokenStore(tokenStore);

      const report = await computeUsageReport();

      assert.equal(report.seats.scimActiveUsers, 1);
      assert.equal(report.seats.scimInactiveUsers, 1);
      assert.equal(report.seats.workspaceMembersWithRoleOverrides, 2);
      assert.equal(report.activity.workspaceCount, 1);
      assert.equal(report.activity.activeMachineTokens, 1);
      assert.equal(report.seats.licensedSeats, undefined);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }));

test('computeUsageReport buckets audit log events by top-level category within the window', () =>
  withIsolatedCtxhubHome(async () => {
    eventBus.publish({ type: 'auth.login', sub: 'user-1', email: 'user-1@example.com', name: 'User One', roles: ['member'], provider: 'saml' });
    eventBus.publish({ type: 'auth.login', sub: 'user-2', email: 'user-2@example.com', name: 'User Two', roles: ['member'], provider: 'saml' });
    // Give the fire-and-forget audit-log write (eventBus.publish, deliberately not awaited) a
    // moment to land on disk before computeUsageReport reads the log back.
    await new Promise(resolve => setTimeout(resolve, 50));

    const report = await computeUsageReport();
    assert.equal(report.activity.totalEvents, 2);
    assert.equal(report.activity.eventsByCategory['auth'], 2);
  }));

test('computeUsageReport returns zero counts with no data on disk', () =>
  withIsolatedCtxhubHome(async () => {
    const report = await computeUsageReport();
    assert.equal(report.seats.scimActiveUsers, 0);
    assert.equal(report.seats.workspaceMembersWithRoleOverrides, 0);
    assert.equal(report.activity.workspaceCount, 0);
    assert.equal(report.activity.totalEvents, 0);
  }));
