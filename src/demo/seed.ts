import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { getCtxhubHome } from '../workspaces/registry.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
import { loadCaptainTasks, saveCaptainTasks, type CaptainTaskFile } from '../captains/tasks.js';
import { getCaptainRunsDir, type CaptainRunRecord } from '../captains/runner.js';
import { saveKnowledgeStore } from '../knowledge/store.js';
import type { KnowledgeStore } from '../knowledge/types.js';
import { loadGroupStore, saveGroupStore } from '../groups/store.js';
import type { GroupStore } from '../groups/types.js';
import { loadCustomRoleStore, saveCustomRoleStore } from '../auth/customRoleStore.js';
import type { CustomRoleStore } from '../auth/customRoles.js';
import { loadScimStore, saveScimStore } from '../scim/store.js';
import type { ScimUser } from '../scim/types.js';
import { loadMachineTokenStore, saveMachineTokenStore, generateRawToken, hashToken } from '../auth/machineTokenStore.js';
import { installBlueprintArchive } from '../commands/blueprint.js';
import { execa } from '../utils/execa-lite.js';
import { getSyncConfig } from '../cloud/sync.js';
import { publishBlueprint } from '../blueprints/registryClient.js';
import { loadJobDefinitions, saveJobDefinitions, saveJobRun } from '../jobs/jobStore.js';
import type { JobDefinitionFile, JobRun } from '../jobs/types.js';
import type { CtxhubEventEnvelope } from '../events/eventBus.js';
import type { UsageStats } from '../utils/usageStats.js';

export type DemoSeedSummary = {
  knowledgeObjects: number; captains: number; captainRuns: number; groups: number; jobs: number; events: number;
  scimUsers: number; machineTokens: number; blueprints: number; blueprintPublishedToCloud: boolean;
};

const isoDaysAgo = (days: number, hour = 10): string => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};
const dateDaysAgo = (days: number): string => isoDaysAgo(days).slice(0, 10);

/** Seed Mission Control's non-document stores without an LLM or external services. */
export async function seedDemoFeatureData(workspaceName: string, workspaceRoot: string): Promise<DemoSeedSummary> {
  const knowledge: KnowledgeStore = {
    version: 1,
    objects: [
      { id: 'demo-ko-postgres', workspaceId: workspaceName, title: 'PostgreSQL is the default primary datastore', content: 'New services use PostgreSQL 15 unless architecture review approves a documented exception.', state: 'active', confidence: 0.96, corroborations: ['demo-ko-pooling'], tags: ['architecture', 'database', 'decision'], createdAt: isoDaysAgo(45), updatedAt: isoDaysAgo(12), createdBy: 'captain:architecture-review' },
      { id: 'demo-ko-pooling', workspaceId: workspaceName, title: 'Database connections are pooled through PgBouncer', content: 'Each service instance uses a PgBouncer sidecar with a maximum pool size of 20 connections.', state: 'active', confidence: 0.89, corroborations: ['demo-ko-postgres'], tags: ['architecture', 'database', 'operations'], createdAt: isoDaysAgo(31), updatedAt: isoDaysAgo(8), createdBy: 'captain:reliability-watch' },
      { id: 'demo-ko-auth', workspaceId: workspaceName, title: 'Browser authentication requires OIDC with PKCE', content: 'Browser clients authenticate through Microsoft Entra ID using OIDC and PKCE; tokens are never stored in localStorage.', state: 'active', confidence: 0.93, corroborations: [], tags: ['security', 'authentication', 'decision'], createdAt: isoDaysAgo(24), updatedAt: isoDaysAgo(6), createdBy: 'captain:security-review' },
      { id: 'demo-ko-canary', workspaceId: workspaceName, title: 'Production uses a staged canary rollout', content: 'Production deployment progresses through 25%, 50%, and 100% stages with an automatic pause above 0.5% errors.', state: 'draft', confidence: 0.71, corroborations: [], reviewFlag: true, tags: ['deployment', 'reliability'], createdAt: isoDaysAgo(3), updatedAt: isoDaysAgo(1), createdBy: 'captain:reliability-watch' },
    ],
    edges: [
      { id: 'demo-edge-db', fromId: 'demo-ko-pooling', toId: 'demo-ko-postgres', edgeType: 'supports', description: 'The runtime pooling standard implements the datastore decision.', confidence: 0.91, createdAt: isoDaysAgo(12), createdBy: 'ctxhub demo' },
      { id: 'demo-edge-release', fromId: 'demo-ko-canary', toId: 'demo-ko-postgres', edgeType: 'related_to', description: 'The rollout policy applies to services using the platform datastore.', confidence: 0.68, createdAt: isoDaysAgo(1), createdBy: 'ctxhub demo' },
    ],
    concepts: [
      { id: 'demo-concept-platform', name: 'Platform architecture', description: 'Shared technical standards for platform services.', relatedObjectIds: ['demo-ko-postgres', 'demo-ko-pooling', 'demo-ko-auth'], createdAt: isoDaysAgo(45), updatedAt: isoDaysAgo(6) },
      { id: 'demo-concept-delivery', name: 'Safe delivery', description: 'Controls that reduce deployment and operational risk.', relatedObjectIds: ['demo-ko-canary', 'demo-ko-pooling'], createdAt: isoDaysAgo(12), updatedAt: isoDaysAgo(1) },
    ],
  };
  await saveKnowledgeStore(workspaceName, knowledge);

  const captainTasks: CaptainTaskFile = { version: 1, tasks: [
    { name: 'architecture-review', workspace: workspaceName, query: 'Review current architecture decisions and identify drift.', persona: 'architect', schedule: { everyMinutes: 1440 }, handoffTo: 'security-review' },
    { name: 'security-review', workspace: workspaceName, query: 'Check authentication and deployment guidance for security risks.', persona: 'security-reviewer' },
    { name: 'reliability-watch', workspace: workspaceName, query: 'Find operational risks and gaps in incident readiness.', schedule: { everyMinutes: 360 } },
  ] };
  const existingCaptainTasks = await loadCaptainTasks();
  const demoCaptainNames = new Set(captainTasks.tasks.map(task => task.name));
  await saveCaptainTasks({ version: 1, tasks: [...existingCaptainTasks.tasks.filter(task => !demoCaptainNames.has(task.name)), ...captainTasks.tasks] });

  const captainRuns: CaptainRunRecord[] = [
    demoCaptainRun('architecture-review', workspaceName, 'demo-run-architecture', 2, 'The datastore and authentication decisions are consistent across the architecture docs.', 'docs/decisions/adr-001-database.md'),
    demoCaptainRun('security-review', workspaceName, 'demo-run-security', 1, 'OIDC with PKCE is documented; add an explicit emergency token-revocation exercise.', 'docs/decisions/adr-002-auth.md', 'architecture-review'),
    demoCaptainRun('reliability-watch', workspaceName, 'demo-run-reliability', 0, 'The canary threshold is documented, but ownership for a paused rollout needs human review.', 'docs/runbooks/deploy.md'),
  ];
  for (const run of captainRuns) {
    const dir = getCaptainRunsDir(run.task);
    await ensureDir(dir);
    await writeText(path.join(dir, `${run.runId}.json`), `${JSON.stringify(run, null, 2)}\n`);
  }
  const captainStatsPath = path.join(getCtxhubHome(), 'captain-stats.json');
  const existingCaptainStats = await readJsonRecord(captainStatsPath);
  await writeText(captainStatsPath, `${JSON.stringify({ ...existingCaptainStats, 'architecture-review': { runs: 8, promoted: 5 }, 'security-review': { runs: 7, promoted: 3 }, 'reliability-watch': { runs: 18, promoted: 9 } }, null, 2)}\n`);

  const groups: GroupStore = {
    version: 1,
    groups: [{ id: 'demo-group-acme', name: 'Acme Engineering Group', createdAt: isoDaysAgo(90), createdBy: 'demo-admin' }],
    orgs: [
      { id: 'demo-org-platform', groupId: 'demo-group-acme', name: 'Platform Engineering', tenantId: 'demo-tenant-platform', trustTier: 'trusted', lastSeen: isoDaysAgo(0), registeredAt: isoDaysAgo(60), addedAt: isoDaysAgo(90), addedBy: 'demo-admin' },
      { id: 'demo-org-product', groupId: 'demo-group-acme', name: 'Product Engineering', tenantId: 'demo-tenant-product', trustTier: 'participant', lastSeen: isoDaysAgo(1), registeredAt: isoDaysAgo(45), addedAt: isoDaysAgo(70), addedBy: 'demo-admin' },
      { id: 'demo-org-partner', groupId: 'demo-group-acme', name: 'Delivery Partner', tenantId: 'demo-tenant-partner', trustTier: 'observer', lastSeen: isoDaysAgo(4), registeredAt: isoDaysAgo(20), addedAt: isoDaysAgo(20), addedBy: 'demo-admin' },
    ],
    sharingPolicies: [
      { fromOrgId: 'demo-org-platform', toOrgId: 'demo-org-product', mode: 'bidirectional', updatedAt: isoDaysAgo(14), updatedBy: 'demo-admin' },
      { fromOrgId: 'demo-org-platform', toOrgId: 'demo-org-partner', mode: 'read', updatedAt: isoDaysAgo(14), updatedBy: 'demo-admin' },
    ],
  };
  const existingGroups = await loadGroupStore();
  const demoGroupIds = new Set(groups.groups.map(group => group.id));
  const demoOrgIds = new Set(groups.orgs.map(org => org.id));
  await saveGroupStore({
    version: 1,
    groups: [...existingGroups.groups.filter(group => !demoGroupIds.has(group.id)), ...groups.groups],
    orgs: [...existingGroups.orgs.filter(org => !demoOrgIds.has(org.id)), ...groups.orgs],
    sharingPolicies: [...existingGroups.sharingPolicies.filter(policy => !demoOrgIds.has(policy.fromOrgId) && !demoOrgIds.has(policy.toOrgId)), ...groups.sharingPolicies],
  });

  const roles: CustomRoleStore = { version: 1, roles: [
    { name: 'knowledge-steward', description: 'Reviews and promotes engineering knowledge.', permissions: ['knowledge:promote', 'audit:read'], inheritsFrom: 'member', createdAt: isoDaysAgo(60), createdBy: 'demo-admin' },
    { name: 'mission-observer', description: 'Read-only access for delivery stakeholders.', permissions: ['audit:read'], inheritsFrom: 'reader', createdAt: isoDaysAgo(30), createdBy: 'demo-admin' },
  ] };
  const existingRoles = await loadCustomRoleStore();
  const demoRoleNames = new Set(roles.roles.map(role => role.name));
  await saveCustomRoleStore({ version: 1, roles: [...existingRoles.roles.filter(role => !demoRoleNames.has(role.name)), ...roles.roles] });

  const jobs: JobDefinitionFile = { version: 1, jobs: [{
    name: 'release-readiness', description: 'Evidence-grounded release review with security handoff.', schedule: { everyMinutes: 1440 },
    steps: [
      { name: 'architecture', workspace: workspaceName, query: 'Review architecture changes for release risk.', captainTask: 'architecture-review' },
      { name: 'security', workspace: workspaceName, query: 'Review {prev.answer} for security concerns.', captainTask: 'security-review' },
      { name: 'summary', workspace: workspaceName, query: 'Create a release recommendation from {steps.architecture.answer} and {steps.security.answer}.', persist: true },
    ],
  }] };
  const existingJobs = await loadJobDefinitions();
  const demoJobNames = new Set(jobs.jobs.map(job => job.name));
  await saveJobDefinitions({ version: 1, jobs: [...existingJobs.jobs.filter(job => !demoJobNames.has(job.name)), ...jobs.jobs] });
  const jobRun: JobRun = { jobId: 'demo-release-readiness-run', job: 'release-readiness', status: 'completed', startedAt: isoDaysAgo(1, 8), completedAt: isoDaysAgo(1, 8), steps: jobs.jobs[0].steps.map(step => ({ stepName: step.name, status: 'completed', startedAt: isoDaysAgo(1, 8), completedAt: isoDaysAgo(1, 8), result: { answer: [`${step.name} checks passed with one recommendation for human review.`], citations: [] } })) };
  await saveJobRun(jobRun);

  await ensureDir(path.join(workspaceRoot, '.ctxhub'));
  await writeText(path.join(workspaceRoot, '.ctxhub', 'stats.json'), `${JSON.stringify(demoUsageStats(), null, 2)}\n`);
  const events = demoEvents(workspaceName);
  const eventPath = path.join(getCtxhubHome(), 'events.jsonl');
  const existingEvents = await readJsonLines(eventPath);
  const demoEventIds = new Set(events.map(event => event.id));
  await writeText(eventPath, `${[...existingEvents.filter(event => !demoEventIds.has(event.id)), ...events].map(event => JSON.stringify(event)).join('\n')}\n`);

  const scimUsers = await seedScimUsers();
  const machineTokens = await seedMachineToken();
  const { blueprints, publishedToCloud } = await seedBlueprint();

  return {
    knowledgeObjects: knowledge.objects.length, captains: captainTasks.tasks.length, captainRuns: captainRuns.length,
    groups: groups.groups.length, jobs: jobs.jobs.length, events: events.length,
    scimUsers, machineTokens, blueprints, blueprintPublishedToCloud: publishedToCloud,
  };
}

// ── SCIM users ────────────────────────────────────────────────────────────────
// Real records in the same store `/scim/v2/Users` reads from -- not a separate fixture --
// so the Config view's member list and SCIM API show the same seeded people.

async function seedScimUsers(): Promise<number> {
  const store = await loadScimStore();
  const now = new Date().toISOString();
  const demoUsers: Array<{ id: string; userName: string; displayName: string }> = [
    { id: 'demo-scim-alice', userName: 'alice@acme-engineering.example', displayName: 'Alice Chen (Principal Engineer)' },
    { id: 'demo-scim-bob', userName: 'bob@acme-engineering.example', displayName: 'Bob Okafor (Security Reviewer)' },
  ];
  const seeded: ScimUser[] = demoUsers.map(u => ({
    id: u.id,
    userName: u.userName,
    displayName: u.displayName,
    active: true,
    emails: [{ value: u.userName, primary: true }],
    meta: { resourceType: 'User', created: now, lastModified: now, location: `/scim/v2/Users/${u.id}` },
  }));
  const demoIds = new Set(seeded.map(u => u.id));
  await saveScimStore({ ...store, users: [...store.users.filter(u => !demoIds.has(u.id)), ...seeded] });
  return seeded.length;
}

// ── Machine token ────────────────────────────────────────────────────────────
// A real, usable ctxm_ token -- generated fresh each seed run since the raw value is never
// recoverable from the hash, matching how `ctxhub machine-token create` works for real.

async function seedMachineToken(): Promise<number> {
  const store = await loadMachineTokenStore();
  const filtered = store.tokens.filter(t => t.name !== 'demo-ci');
  const raw = generateRawToken();
  filtered.push({
    id: 'demo-machine-token',
    name: 'demo-ci',
    hashedToken: await hashToken(raw),
    roles: ['machine'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await saveMachineTokenStore({ ...store, tokens: filtered });
  return 1;
}

// ── Blueprint (local pack + install; best-effort publish to Cloud's Hub) ────────
// Packs a real .ctxblueprint archive (same `tar czf` a human running `ctxhub blueprint pack`
// would produce) and installs it through the same throw-based installBlueprintArchive() the
// HTTP handler uses -- not a hand-written InstalledBlueprint record.

async function seedBlueprint(): Promise<{ blueprints: number; publishedToCloud: boolean }> {
  const sourceDir = path.join(os.tmpdir(), 'ctxhub-demo-blueprint-source');
  await mkdir(sourceDir, { recursive: true });
  await writeText(path.join(sourceDir, 'blueprint.yaml'), [
    'name: secure-service-launch',
    'version: 1.0.0',
    'description: Security, architecture, and release-readiness Captains for launching a new service.',
    'author: ctxhub demo',
    'tags: [security, platform, demo]',
    'serviceTypes: [api]',
  ].join('\n'));

  const archivePath = path.join(os.tmpdir(), 'secure-service-launch-1.0.0.ctxblueprint');
  await execa('tar', ['-czf', archivePath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  await installBlueprintArchive(archivePath, { ignoreDeps: true });

  let publishedToCloud = false;
  const syncConfig = await getSyncConfig();
  if (syncConfig) {
    try {
      const archive = await readFile(archivePath);
      await publishBlueprint(syncConfig, archive, {
        name: 'secure-service-launch',
        version: '1.0.0',
        description: 'Security, architecture, and release-readiness Captains for launching a new service.',
        author: 'ctxhub demo',
        tags: ['security', 'platform', 'demo'],
        serviceTypes: ['api'],
        public: true,
      });
      publishedToCloud = true;
    } catch {
      // Cloud configured but unreachable (e.g. no local Cloud service running) -- local
      // install above already succeeded and is this function's primary contract.
    }
  }

  return { blueprints: 1, publishedToCloud };
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(filePath))) return {};
  try { return JSON.parse(await readText(filePath)) as Record<string, unknown>; } catch { return {}; }
}

async function readJsonLines(filePath: string): Promise<CtxhubEventEnvelope[]> {
  if (!(await pathExists(filePath))) return [];
  const events: CtxhubEventEnvelope[] = [];
  for (const line of (await readText(filePath)).split('\n').filter(Boolean)) {
    try { events.push(JSON.parse(line) as CtxhubEventEnvelope); } catch { /* retain valid events around a malformed line */ }
  }
  return events;
}

function demoCaptainRun(task: string, workspace: string, runId: string, daysAgo: number, answer: string, filePath: string, handoffFrom?: string): CaptainRunRecord {
  const ref = 'E1';
  return { runId, task, workspace, startedAt: isoDaysAgo(daysAgo), ...(handoffFrom ? { handoffFrom } : {}), result: { query: `Demo analysis from ${task}`, workspace, generatedAt: isoDaysAgo(daysAgo), answer: [answer], evidence: [{ ref, repo: 'demo-docs', path: filePath, title: path.basename(filePath), snippet: answer, stale: false, kind: 'context' }], citations: [{ ref, repo: 'demo-docs', path: filePath, title: path.basename(filePath) }], freshness: { staleCount: 0, notes: [] }, suggestedReadingOrder: [{ repo: 'demo-docs', path: filePath, title: path.basename(filePath) }], llmNotice: 'Seeded demo result — no external model call was made.' } };
}

function demoUsageStats(): UsageStats {
  const daily: NonNullable<UsageStats['daily']> = {};
  for (let days = 13; days >= 0; days--) {
    const multiplier = 14 - days;
    daily[dateDaysAgo(days)] = {
      search: { calls: 7 + multiplier, tokensReturned: 420 + multiplier * 18, tokensBaseline: 3400 + multiplier * 210 },
      pack: { calls: 2 + Math.floor(multiplier / 3), tokensReturned: 260 + multiplier * 12, tokensBaseline: 2100 + multiplier * 145 },
      explain: { calls: 1 + Math.floor(multiplier / 5), tokensReturned: 520 + multiplier * 15, tokensBaseline: 3900 + multiplier * 180 },
    };
  }
  const tools: UsageStats['tools'] = {};
  for (const byTool of Object.values(daily)) for (const [tool, value] of Object.entries(byTool)) {
    const total = tools[tool] ?? { calls: 0, tokensReturned: 0, tokensBaseline: 0 };
    tools[tool] = { calls: total.calls + value.calls, tokensReturned: total.tokensReturned + value.tokensReturned, tokensBaseline: total.tokensBaseline + value.tokensBaseline };
  }
  return { since: isoDaysAgo(13), lastUpdated: isoDaysAgo(0), tools, daily };
}

function demoEvents(workspace: string): CtxhubEventEnvelope[] {
  return [
    { id: 'demo-event-1', at: isoDaysAgo(2), type: 'captain.run.started', task: 'architecture-review', workspace },
    { id: 'demo-event-2', at: isoDaysAgo(2), type: 'captain.run.completed', task: 'architecture-review', workspace, runId: 'demo-run-architecture' },
    { id: 'demo-event-3', at: isoDaysAgo(1), type: 'captain.handoff', from: 'architecture-review', to: 'security-review', fromWorkspace: workspace, toWorkspace: workspace },
    { id: 'demo-event-4', at: isoDaysAgo(1), type: 'captain.run.completed', task: 'security-review', workspace, runId: 'demo-run-security' },
    { id: 'demo-event-5', at: isoDaysAgo(1), type: 'job.completed', jobId: 'demo-release-readiness-run', job: 'release-readiness' },
    { id: 'demo-event-6', at: isoDaysAgo(0), type: 'captain.run.completed', task: 'reliability-watch', workspace, runId: 'demo-run-reliability' },
  ];
}
