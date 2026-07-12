import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import yaml from 'js-yaml';
import { demoCommand } from '../../dist/commands/demo.js';
import { runForegroundService } from '../../dist/commands/service.js';
import { loadWorkspaceConfig } from '../../dist/config/config.js';
import { isAgentCliAvailable } from '../../dist/llm/runAgent.js';
import { writeText } from '../../dist/utils/fs.js';
import { initPersonas, syncPersonas } from '../../dist/commands/personas.js';
import { installSkills } from '../../dist/commands/skills.js';
import { saveCloudConfig } from '../../dist/commands/cloud.js';

export const PROMO_PORT = 7344;
const PROMO_CLOUD_PORT = 7345;

function startDemoCloud(): Promise<http.Server> {
  const now = new Date().toISOString();
  const knowledge = { id: 'cloud-ko-1', orgId: 'demo-group-acme', workspaceId: 'ctxhub-demo', localId: 'demo-ko-postgres', promotedBy: 'principal-engineer', promotedAt: now, title: 'PostgreSQL is the platform default', body: 'New services use PostgreSQL unless architecture review approves an exception.', state: 'active', confidence: 0.96, corroborations: 3, reviewFlag: false, conceptIds: ['platform-architecture'], syncedAt: now };
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PROMO_CLOUD_PORT}`);
    if (url.pathname === '/sync/history') return res.end(JSON.stringify({ runs: [{ id: 'cloud-run-1', orgId: 'demo-group-acme', workspaceId: 'ctxhub-demo', taskName: 'architecture-review', startedAt: now, completedAt: now, status: 'completed', findingsCount: 4, promotedCount: 2, syncedAt: now }], notes: [{ id: 'cloud-note-1', orgId: 'demo-group-acme', workspaceId: 'ctxhub-demo', title: 'Production canary rollout policy', content: 'Release stages and rollback thresholds.', promotedAt: now, promotedBy: 'principal-engineer', trustTier: 'institutional', syncedAt: now }] }));
    if (url.pathname === '/blueprints') return res.end(JSON.stringify({ blueprints: [
      { name: 'secure-service-launch', version: '1.2.0', description: 'Security, architecture, testing, and release-readiness Captains for a new service.', author: 'ctxhub', tags: ['security', 'platform'], serviceTypes: ['api'], orgId: null, publishedBy: 'ctxhub', publishedAt: now, archiveHash: 'demo', archiveSize: 4096 },
      { name: 'incident-response', version: '2.0.0', description: 'A complete evidence-first incident response and post-mortem workflow.', author: 'Acme SRE', tags: ['incident', 'sre'], serviceTypes: ['api', 'worker'], orgId: 'demo-group-acme', publishedBy: 'sre-lead', publishedAt: now, archiveHash: 'demo2', archiveSize: 8192 },
    ] }));
    if (url.pathname === '/knowledge') return res.end(JSON.stringify({ objects: [knowledge], count: 1 }));
    if (url.pathname === '/knowledge/cloud-ko-1') return res.end(JSON.stringify({ object: knowledge, edges: [{ id: 'cloud-edge-1', orgId: 'demo-group-acme', fromId: 'cloud-ko-1', toId: 'cloud-ko-2', edgeType: 'related_to', createdBy: 'human', createdAt: now }] }));
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
  });
  return new Promise((resolve, reject) => server.once('error', reject).listen(PROMO_CLOUD_PORT, '127.0.0.1', () => resolve(server)));
}

async function preferBundledCodex(): Promise<void> {
  if (process.env.PROMO_CODEX_BIN_DIR) {
    process.env.PATH = `${process.env.PROMO_CODEX_BIN_DIR}:${process.env.PATH ?? ''}`;
    return;
  }
  // VS Code's OpenAI extension often ships a newer Codex CLI than a package-manager shim.
  // Prefer the newest installed extension for the disposable recording process only.
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const versions = (await readdir(extensionsDir)).filter(name => name.startsWith('openai.chatgpt-')).sort().reverse();
    const platform = process.platform === 'darwin' ? 'macos' : process.platform;
    const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
    for (const version of versions) {
      const binDir = path.join(extensionsDir, version, 'bin', `${platform}-${arch}`);
      try {
        if ((await readdir(binDir)).includes('codex')) {
          process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
          return;
        }
      } catch { /* try the next installed extension */ }
    }
  } catch { /* fall through to the caller's PATH */ }
}

/** A disposable real demo environment, separate from both ~/.ctxhub and functional E2E. */
export default async function promoGlobalSetup() {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-promo-home-'));
  process.env.CTXHUB_HOME = ctxhubHome;

  await demoCommand({ force: true });
  await preferBundledCodex();
  if (!(await isAgentCliAvailable('codex'))) {
    throw new Error('The promo recorder requires an authenticated Codex CLI on PATH. Run `codex --version` and authenticate before recording.');
  }

  // The general-purpose demo stays offline-safe; the promo explicitly opts its disposable
  // workspace into live Codex synthesis so the recorded Chat interaction is genuinely LLM-backed.
  const workspaceRoot = path.join(ctxhubHome, 'demo-workspace');
  const { config } = await loadWorkspaceConfig(workspaceRoot);
  config.llm = { enabled: true, agent: 'codex', timeoutMs: 180_000, fallbackProfiles: ['promo-codex-retry', 'promo-claude'] };
  config.executionProfiles['promo-codex-retry'] = { runtime: 'codex', tags: ['promo', 'retry'] };
  config.executionProfiles['promo-claude'] = { runtime: 'claude', tags: ['promo', 'fallback'] };
  await writeText(path.join(workspaceRoot, '.ctxhub', 'config.yaml'), yaml.dump(config, { lineWidth: 120 }));
  await initPersonas(workspaceRoot);
  await syncPersonas(['codex'], workspaceRoot);
  await installSkills(['codex'], workspaceRoot);
  await writeText(path.join(workspaceRoot, 'docs', 'architecture.md'), `${await (await import('../../dist/utils/fs.js')).readText(path.join(workspaceRoot, 'docs', 'architecture.md'))}\n\n## Proposed change\nProduction services must publish dependency ownership metadata.\n`);
  await writeText(path.join(workspaceRoot, '.ctxhub', 'cache', 'evals', 'latest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), suitePath: '.ctxhub/cache/eval.json', summary: { total: 4, passed: 3, failed: 1 }, cases: [
    { query: 'How do we deploy safely?', rationale: 'Release guidance must rank first.', passed: true, expected: [{ repo: 'demo-docs', path: 'docs/runbooks/deploy.md', rank: 1, score: 0.94 }], missing: [], topResults: [{ repo: 'demo-docs', path: 'docs/runbooks/deploy.md', title: 'Deployment Runbook', score: 0.94 }] },
    { query: 'How are browser tokens protected?', passed: true, expected: [{ repo: 'demo-docs', path: 'docs/decisions/adr-002-auth.md', rank: 1, score: 0.91 }], missing: [], topResults: [{ repo: 'demo-docs', path: 'docs/decisions/adr-002-auth.md', score: 0.91 }] },
    { query: 'What is the database standard?', passed: true, expected: [{ repo: 'demo-docs', path: 'docs/decisions/adr-001-database.md', rank: 1, score: 0.9 }], missing: [], topResults: [{ repo: 'demo-docs', path: 'docs/decisions/adr-001-database.md', score: 0.9 }] },
    { query: 'Who owns rollback approval?', passed: false, expected: [{ repo: 'demo-docs', path: 'docs/ownership.md' }], missing: [{ repo: 'demo-docs', path: 'docs/ownership.md' }], topResults: [{ repo: 'demo-docs', path: 'docs/runbooks/deploy.md', score: 0.63 }] },
  ] }, null, 2)}\n`);
  const cloud = await startDemoCloud();
  await saveCloudConfig({ endpoint: `http://127.0.0.1:${PROMO_CLOUD_PORT}`, apiKey: 'demo-key', lastSyncAt: new Date().toISOString(), chunksSynced: 18 });
  const handle = await runForegroundService(PROMO_PORT, { log: () => {} });

  return async () => {
    await handle.stop();
    await new Promise<void>(resolve => cloud.close(() => resolve()));
    await rm(ctxhubHome, { recursive: true, force: true });
  };
}
