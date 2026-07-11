import chalk from 'chalk';
import { getPackageVersion } from '../utils/version.js';
import { isAuthConfigured } from '../auth/config.js';
import { loadTokens } from '../auth/store.js';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadGroupStore } from '../groups/store.js';
import { loadBlueprintStore } from '../blueprints/store.js';
import { loadMachineTokenStore } from '../auth/machineTokenStore.js';
import { DEFAULT_SERVICE_PORT } from '../service/server.js';

const TICK = chalk.green('✓');
const CROSS = chalk.red('✗');

export async function statusCommand(): Promise<void> {
  const version = getPackageVersion();
  console.log(`ctxhub v${version}\n`);

  // Auth
  await printAuthStatus();

  // Service
  await printServiceStatus();

  // Workspaces + chunks
  await printWorkspacesStatus();

  // Groups
  await printGroupsStatus();

  // Blueprints
  await printBlueprintsStatus();

  // Machine tokens
  await printMachineTokensStatus();
}

async function printAuthStatus(): Promise<void> {
  const label = 'Auth      ';
  try {
    const configured = await isAuthConfigured();
    if (!configured) {
      console.log(`${label} ${CROSS} not configured`);
      return;
    }
    const tokens = await loadTokens();
    if (!tokens) {
      console.log(`${label} ${CROSS} not logged in`);
      return;
    }
    const user = tokens.user;
    // role comes from the stored ctxhub JWT payload; decode without verify (display only)
    let role = '';
    try {
      const payload = JSON.parse(Buffer.from(tokens.ctxhubToken.token.split('.')[1], 'base64').toString()) as { roles?: string[] };
      role = payload.roles?.[0] ?? '';
    } catch {
      // best-effort
    }
    const roleStr = role ? ` (${role})` : '';
    console.log(`${label} ${TICK} ${user.name} <${user.email}>${roleStr}`);
  } catch {
    console.log(`${label} ${CROSS} error reading auth state`);
  }
}

async function printServiceStatus(): Promise<void> {
  const label = 'Service   ';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500);
    try {
      const r = await fetch(`http://localhost:${DEFAULT_SERVICE_PORT}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (r.ok) {
        console.log(`${label} ${TICK} running on :${DEFAULT_SERVICE_PORT}`);
      } else {
        console.log(`${label} ${CROSS} not running`);
      }
    } catch {
      clearTimeout(timeoutId);
      console.log(`${label} ${CROSS} not running`);
    }
  } catch {
    console.log(`${label} ${CROSS} not running`);
  }
}

async function printWorkspacesStatus(): Promise<void> {
  const label = 'Workspaces';
  try {
    const workspaces = await listWorkspaces();
    const wsCount = workspaces.length;

    // Try to count total indexed chunks across all workspaces
    let totalChunks = 0;
    for (const ws of workspaces.filter(w => w.exists)) {
      try {
        const { loadWorkspaceConfig } = await import('../config/config.js');
        const { createIndexProvider } = await import('../indexing/providers.js');
        const { config } = await loadWorkspaceConfig(ws.path);
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, ws.path);
        const results = await index.search('', 500);
        totalChunks += results.length;
      } catch {
        // skip unreachable workspace
      }
    }

    const chunkStr = totalChunks > 0 ? ` (${totalChunks} chunks indexed)` : '';
    console.log(`${label} ${wsCount} registered${chunkStr}`);
  } catch {
    console.log(`${label} ${CROSS} error reading workspace registry`);
  }
}

async function printGroupsStatus(): Promise<void> {
  const label = 'Groups    ';
  try {
    const store = await loadGroupStore();
    const groupCount = store.groups.length;
    const orgCount = store.orgs.length;
    if (groupCount === 0 && orgCount === 0) {
      console.log(`${label} none`);
    } else {
      const parts: string[] = [];
      if (groupCount > 0) parts.push(`${groupCount} corporate group${groupCount !== 1 ? 's' : ''}`);
      if (orgCount > 0) parts.push(`${orgCount} org${orgCount !== 1 ? 's' : ''}`);
      console.log(`${label} ${parts.join(', ')}`);
    }
  } catch {
    console.log(`${label} ${CROSS} error reading group store`);
  }
}

async function printBlueprintsStatus(): Promise<void> {
  const label = 'Blueprints';
  try {
    const store = await loadBlueprintStore();
    const count = store.installed.length;
    console.log(`${label} ${count} installed`);
  } catch {
    console.log(`${label} ${CROSS} error reading blueprint store`);
  }
}

async function printMachineTokensStatus(): Promise<void> {
  const label = 'Machine   ';
  try {
    const store = await loadMachineTokenStore();
    const now = new Date();
    const active = store.tokens.filter(t => {
      if (t.revokedAt) return false;
      if (new Date(t.expiresAt) < now) return false;
      return true;
    });
    console.log(`${label} ${active.length} active token${active.length !== 1 ? 's' : ''}`);
  } catch {
    console.log(`${label} ${CROSS} error reading machine token store`);
  }
}
