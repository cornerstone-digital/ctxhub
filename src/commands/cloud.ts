import path from 'node:path';
import chalk from 'chalk';
import { getCtxhubHome, listWorkspaces } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { getSyncConfig, syncToCloud, syncRunsToCloud } from '../cloud/sync.js';
import { loadCaptainTasks } from '../captains/tasks.js';
import { listCaptainRuns } from '../captains/runner.js';

// ── Cloud config file ─────────────────────────────────────────────────────────

export interface CloudConfig {
  endpoint: string;
  apiKey: string;
  lastSyncAt?: string;     // ISO timestamp of last successful sync
  chunksSynced?: number;   // cumulative total chunks synced
}

export function getCloudConfigPath(): string {
  return path.join(getCtxhubHome(), 'cloud.json');
}

export async function loadCloudConfig(): Promise<CloudConfig | null> {
  const configPath = getCloudConfigPath();
  if (!(await pathExists(configPath))) return null;
  try {
    const raw = await readText(configPath);
    return JSON.parse(raw) as CloudConfig;
  } catch {
    return null;
  }
}

export async function saveCloudConfig(config: CloudConfig): Promise<void> {
  await writeText(getCloudConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

// ── cloudConfigureCommand ─────────────────────────────────────────────────────

export async function cloudConfigureCommand(opts: { endpoint: string; apiKey: string }): Promise<void> {
  if (!opts.endpoint?.trim()) {
    console.error('Error: --endpoint is required');
    process.exit(1);
  }
  if (!opts.apiKey?.trim()) {
    console.error('Error: --api-key is required');
    process.exit(1);
  }

  const existing = await loadCloudConfig();
  const config: CloudConfig = {
    ...existing,
    endpoint: opts.endpoint.trim(),
    apiKey: opts.apiKey.trim(),
  };

  await saveCloudConfig(config);

  console.log(chalk.green('Cloud sync configured.'));
  console.log(chalk.gray(`Endpoint: ${config.endpoint}`));
  console.log(chalk.gray(`Config saved to: ${getCloudConfigPath()}`));
  console.log('');
  console.log(chalk.gray('Run `ctxhub sync --to-cloud` to push promoted chunks to Cloud.'));
}

// ── cloudStatusCommand ────────────────────────────────────────────────────────

export async function cloudStatusCommand(): Promise<void> {
  const config = await loadCloudConfig();

  if (!config) {
    console.log(chalk.bold('Cloud sync: ') + chalk.yellow('not configured'));
    console.log('');
    console.log(chalk.gray('Configure with: ctxhub cloud configure --endpoint <url> --api-key <key>'));
    console.log(chalk.gray('Or set:         CTXHUB_CLOUD_ENDPOINT and CTXHUB_CLOUD_API_KEY'));
    return;
  }

  console.log(chalk.bold('Cloud sync: ') + chalk.green('configured'));
  console.log(`Endpoint:      ${config.endpoint}`);
  console.log(`Last sync:     ${config.lastSyncAt ? formatDate(config.lastSyncAt) : 'never'}`);
  console.log(`Chunks synced: ${config.chunksSynced ?? 0}`);

  // Check env var overrides
  const envEndpoint = process.env['CTXHUB_CLOUD_ENDPOINT'];
  if (envEndpoint && envEndpoint !== config.endpoint) {
    console.log('');
    console.log(chalk.yellow(`Note: CTXHUB_CLOUD_ENDPOINT env var overrides configured endpoint: ${envEndpoint}`));
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── cloudSyncCommand ──────────────────────────────────────────────────────────

export async function cloudSyncCommand(opts: { workspace?: string; dryRun?: boolean }): Promise<void> {
  const cloudConfig = await loadCloudConfig();
  if (!cloudConfig) {
    console.error(chalk.red('Error: Cloud sync not configured.'));
    console.error(chalk.gray('Run: ctxhub cloud configure --endpoint <url> --api-key <key>'));
    process.exit(1);
  }

  const syncConfig = await getSyncConfig();
  if (!syncConfig) {
    console.error(chalk.red('Error: Cloud sync configuration is incomplete (missing API key or endpoint).'));
    process.exit(1);
  }

  // Collect chunks from the requested workspaces
  const workspaces = await listWorkspaces();
  const targets = opts.workspace
    ? workspaces.filter(ws => ws.name === opts.workspace)
    : workspaces.filter(ws => ws.exists);

  if (targets.length === 0) {
    const msg = opts.workspace
      ? `No workspace named "${opts.workspace}" found.`
      : 'No registered workspaces found.';
    console.error(chalk.red(`Error: ${msg}`));
    process.exit(1);
  }

  const allChunks: import('../config/types.js').IndexedDocument[] = [];
  for (const ws of targets) {
    try {
      const { config } = await loadWorkspaceConfig(ws.path);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, ws.path);
      const results = await index.recent(10_000);
      for (const r of results) {
        if (r.trustTier === 'institutional' || r.trustTier === 'canonical') {
          allChunks.push(r);
        }
      }
    } catch {
      // Workspace unreachable — skip silently
    }
  }

  const eligible = allChunks.length;

  if (opts.dryRun) {
    console.log(chalk.bold('Dry run — no data will be sent to Cloud.'));
    console.log('');
    console.log(`Workspaces checked: ${targets.length}`);
    console.log(`Chunks eligible:    ${eligible} institutional/canonical`);
    console.log('');
    console.log(chalk.gray('Remove --dry-run to push chunks to Cloud.'));
    return;
  }

  if (eligible === 0) {
    console.log(chalk.yellow('Nothing to sync — no institutional or canonical chunks found.'));
    console.log(chalk.gray('Promote chunks with: ctxhub chunk promote <id>'));
    return;
  }

  console.log(chalk.gray(`Syncing ${eligible} institutional/canonical chunks to ctxhub Cloud...`));

  const result = await syncToCloud(syncConfig, allChunks);

  if (result.skipped) {
    console.log(chalk.yellow(`Skipped: ${result.reason ?? 'no eligible chunks'}`));
    return;
  }

  if (result.errors && result.errors.length > 0) {
    console.error(chalk.red(`Sync errors:`));
    for (const err of result.errors) {
      console.error(chalk.red(`  ${err}`));
    }
    process.exit(1);
  }

  const synced = result.synced ?? 0;
  console.log(chalk.green(`✓ Synced ${synced} chunk${synced !== 1 ? 's' : ''}`));

  // Best-effort: also push each target workspace's recent Captain run history, same as the
  // HTTP `POST /cloud/sync` route (see server.ts's handleCloudSync). A failure here doesn't
  // fail the command -- chunk sync above already succeeded and is the primary contract.
  try {
    const { tasks } = await loadCaptainTasks();
    let runsSynced = 0;
    for (const ws of targets) {
      const wsTasks = tasks.filter(t => t.workspace === ws.name);
      const runs = (await Promise.all(wsTasks.map(t => listCaptainRuns(t.name, { limit: 50 })))).flatMap(r => r.records);
      if (runs.length === 0) continue;
      await syncRunsToCloud(syncConfig, ws.name, runs);
      runsSynced += runs.length;
    }
    if (runsSynced > 0) console.log(chalk.green(`✓ Synced ${runsSynced} captain run${runsSynced !== 1 ? 's' : ''}`));
  } catch (error) {
    console.log(chalk.yellow(`Captain run sync skipped: ${error instanceof Error ? error.message : String(error)}`));
  }

  // Update the cloud config with the new sync timestamp
  await saveCloudConfig({
    ...cloudConfig,
    lastSyncAt: new Date().toISOString(),
    chunksSynced: (cloudConfig.chunksSynced ?? 0) + synced,
  });
}
