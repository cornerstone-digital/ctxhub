/**
 * ctxhub demo — scaffolds a complete demo environment in ~/.ctxhub/demo-workspace/
 *
 * Creates a realistic workspace with markdown files, indexes it, and promotes two
 * chunks to institutional tier so a first-time user can immediately explore search,
 * Mission Control, and the trust-tier model without setting up a real project.
 */
import path from 'node:path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { ensureDir, pathExists, writeText } from '../utils/fs.js';
import { getCtxhubHome, loadRegistry, saveRegistry, type WorkspaceRegistryEntry } from '../workspaces/registry.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { createIndexProvider } from '../indexing/providers.js';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import type { IndexedDocument } from '../config/types.js';
import { defaultCtxhubIgnoreContent } from '../indexing/ctxhubignore.js';
import { runGit, isGitInstalled } from '../git/git.js';
import { seedDemoFeatureData } from '../demo/seed.js';

const DEMO_WORKSPACE_NAME = 'ctxhub-demo';

// ── Demo document content ─────────────────────────────────────────────────────

const DEMO_DOCS: Array<{ rel: string; content: string }> = [
  {
    rel: 'docs/architecture.md',
    content: `# System Architecture

## Overview

The platform is a multi-tier web application built around three core services: the API gateway,
the business logic service, and the data layer. All services communicate over gRPC internally
and expose a REST API externally via the gateway.

## Database

We use PostgreSQL 15 as the primary datastore. The schema follows an event-sourcing pattern
for audit-critical entities (orders, payments, compliance events). Read models are maintained
as materialised views, refreshed by a background worker on a configurable schedule.

Connection pooling is handled by PgBouncer deployed as a sidecar. Maximum pool size per
service instance is 20 connections. Migrations are managed with Flyway and run as part of
the CI/CD pipeline before service rollout.

## API Layer

The API gateway handles authentication, rate limiting, and request routing. JWT tokens are
validated at the gateway; downstream services trust the \`X-Authenticated-User\` header.

Rate limiting is per-user, sliding window, configurable per endpoint via the admin API.
Default limits are 1000 req/min for authenticated users and 60 req/min for anonymous.

## Authentication

Authentication uses OpenID Connect with Microsoft Entra ID as the identity provider.
The PKCE flow is required for all browser clients. Machine-to-machine auth uses client
credentials flow with scope-restricted service principals.

Token lifetime: access tokens 1 hour, refresh tokens 30 days. Refresh token rotation
is enabled; tokens are stored in an HttpOnly cookie, never localStorage.
`,
  },
  {
    rel: 'docs/onboarding.md',
    content: `# Developer Onboarding Guide

## Welcome

This guide gets a new engineer from zero to a working local environment in under an hour.
If anything takes longer, that's a bug — open an issue.

## Prerequisites

- Node.js 22 (use \`nvm\` or \`fnm\` to manage versions)
- Docker Desktop (for local Postgres and Redis)
- Git with SSH key configured for the org
- 1Password CLI (\`op\`) for secret management

## Setup

1. Clone the repositories:
   \`\`\`bash
   git clone git@github.com:acme/api-service
   git clone git@github.com:acme/web-client
   git clone git@github.com:acme/infra
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   cd api-service && npm ci
   cd ../web-client && npm ci
   \`\`\`

3. Start local infrastructure:
   \`\`\`bash
   docker compose up -d
   \`\`\`

4. Load secrets from 1Password:
   \`\`\`bash
   op inject -i .env.tpl -o .env
   \`\`\`

5. Run database migrations:
   \`\`\`bash
   npm run db:migrate
   \`\`\`

## Tooling

- **Editor**: VSCode is the team standard. Required extensions: ESLint, Prettier, GitLens.
- **Testing**: Jest for unit, Playwright for E2E. Run \`npm test\` locally before pushing.
- **Linting**: Enforced on CI. Run \`npm run lint:fix\` before opening a PR.

## Git Workflow

We use trunk-based development. Short-lived feature branches (< 2 days), squash merge to main.
All PRs require one approval and a passing CI run. No force-pushes to main.

Branch naming: \`feat/<ticket-id>-short-description\`, \`fix/<ticket-id>-short-description\`.
`,
  },
  {
    rel: 'docs/decisions/adr-001-database.md',
    content: `# ADR-001: Choose PostgreSQL as the primary datastore

**Status**: Accepted
**Date**: 2024-03-15
**Deciders**: Platform team

## Context

We needed to choose a primary relational datastore for the platform. The requirements were:
strong ACID guarantees, JSON support for flexible document storage, mature tooling, and
a deployment model compatible with our self-hosted Kubernetes environment.

## Decision

We chose **PostgreSQL 15**.

## Rationale

- **ACID compliance**: critical for financial transaction records and audit logs
- **JSONB support**: enables flexible schema evolution without full migrations for metadata fields
- **Ecosystem**: mature drivers (node-postgres), migration tools (Flyway), and monitoring integrations
- **Operator familiarity**: the team has deep PostgreSQL experience; reducing operational risk mattered more than novelty
- **Extension support**: PostGIS for future geo-queries, pg_trgm for full-text search prototyping

## Alternatives Considered

- **MySQL 8**: rejected due to weaker JSONB support and less predictable locking behaviour under our workload patterns
- **CockroachDB**: rejected due to higher operational complexity and licensing costs at our scale
- **DynamoDB**: rejected because our query patterns are relational, not key-value

## Consequences

- Operational runbooks are standardised on PostgreSQL. See \`runbooks/deploy.md\` for upgrade procedures.
- All new services default to PostgreSQL unless a compelling case is made at architecture review.
- The team maintains a shared Flyway migration library (\`@acme/db-migrations\`) consumed by all services.
`,
  },
  {
    rel: 'docs/decisions/adr-002-auth.md',
    content: `# ADR-002: JWT + OIDC for authentication

**Status**: Accepted
**Date**: 2024-04-02
**Deciders**: Security team, Platform team

## Context

The platform needed an authentication model that supports browser clients, mobile clients,
machine-to-machine service communication, and enterprise SSO requirements (Microsoft Entra ID).
The model must satisfy the company's security policy: no long-lived shared secrets, tokens
must be revocable, and all auth events must be auditable.

## Decision

We use **OpenID Connect (OIDC)** for identity federation and **JWT** as the token format,
with Microsoft Entra ID as the external identity provider and a lightweight internal
token service for machine-to-machine auth.

## Rationale

- **OIDC** is the industry standard for enterprise SSO; Entra ID support was a hard requirement from the enterprise sales team
- **JWT** gives stateless verification at service boundaries without a round-trip to the auth server on every request
- **PKCE** for browser clients eliminates implicit flow vulnerabilities; all browser flows require PKCE
- **Client credentials** for M2M avoids embedding long-lived secrets by scoping tokens to individual service principals with short TTLs

## Alternatives Considered

- **Sessions + cookies only**: rejected because stateful session management doesn't scale to our multi-region ambition
- **SAML 2.0**: rejected as the primary protocol due to complexity; may be added as an alternative federation path in a future milestone
- **API keys only**: insufficient for end-user flows; acceptable for machine tokens but not browser clients

## Consequences

- All services validate JWTs against the published JWKS endpoint. Gateway caches keys with a 5-minute TTL.
- Token refresh rotation is mandatory. Refresh tokens are single-use; reuse detection triggers immediate revocation.
- See \`docs/architecture.md\` for the full auth architecture.
`,
  },
  {
    rel: 'docs/runbooks/deploy.md',
    content: `# Deployment Runbook

## Overview

This runbook covers deploying the platform to staging and production.
All deployments use the same pipeline; environment differences are in configuration, not process.

## Prerequisites

- \`kubectl\` configured for the target cluster (\`kubectl config use-context <env>\`)
- Helm 3.x installed
- Access to the deployment GitHub Actions environment (requires team membership)
- On-call coverage confirmed if deploying to production

## Staging Deployment

Staging deploys automatically on every merge to \`main\`. To trigger manually:

\`\`\`bash
gh workflow run deploy.yml --ref main -f environment=staging
\`\`\`

Staging deploy takes approximately 4 minutes. Verify by checking:
1. All pods in \`Running\` state: \`kubectl get pods -n staging\`
2. Health check returns 200: \`curl https://api.staging.acme.com/health\`
3. Smoke tests pass: \`npm run test:smoke -- --env staging\`

## Production Deployment

Production deploys require a passing staging deployment and a human approval in GitHub Actions.

1. Open the [deployment workflow](https://github.com/acme/infra/actions) in GitHub
2. Confirm the staging smoke tests passed in the preceding staging run
3. Approve the "Deploy to Production" step
4. Monitor the Datadog deployment dashboard during rollout

Production rollout uses a 25%/50%/100% canary strategy with a 3-minute wait between stages.
If error rate exceeds 0.5% during canary, the rollout pauses automatically and pages the on-call.

## Rollback

\`\`\`bash
helm rollback acme-api -n production
\`\`\`

This rolls back to the previous Helm release. Confirm with \`kubectl rollout status deployment/api-service -n production\`.
`,
  },
  {
    rel: 'docs/runbooks/incident.md',
    content: `# Incident Response Runbook

## Severity Levels

| Level | Definition | Response Time | Escalation |
|-------|-----------|---------------|------------|
| P1 | Production down, data loss, security breach | Immediate, 24/7 | VP Engineering within 15 min |
| P2 | Major feature unavailable, significant performance degradation | < 30 min during business hours | Engineering manager within 30 min |
| P3 | Minor feature degraded, workaround exists | < 4 hours | Team lead at next standup |
| P4 | Cosmetic issue, no user impact | Next sprint | None |

## P1/P2 Response Process

1. **Declare the incident** in #incidents Slack channel using \`/incident declare\`
2. **Assign roles**: Incident Commander (IC), Communications Lead, Technical Lead
3. **Create a war room**: Zoom link posted in the Slack incident thread
4. **Initial diagnosis**: check Datadog dashboard, recent deployments, error rates
5. **Communicate**: update the Slack thread every 15 minutes during active response
6. **Mitigate first, investigate second**: restore service before root-cause analysis
7. **Write the post-mortem** within 48 hours of resolution (blameless, facts only)

## Common Failure Modes

### Database connection exhaustion
Check PgBouncer metrics in Datadog. If connection pool is saturated, identify leaking services
with \`SELECT count(*), application_name FROM pg_stat_activity GROUP BY application_name\` on Postgres.

### API gateway returning 502
Usually indicates all upstream instances are unhealthy. Check pod status (\`kubectl get pods -n production\`),
look for crashloops or pending state. Check node resources — 502 storms often follow OOM kills.

### Authentication failures
Check Entra ID service health at https://status.azure.com. Verify JWKS endpoint is reachable.
Token refresh failures often surface as 401 spikes 1 hour after a token issuance event.
`,
  },
];

// ── Command implementation ────────────────────────────────────────────────────

export async function demoCommand(opts: { workspace?: string; force?: boolean } = {}) {
  const workspaceName = opts.workspace ?? DEMO_WORKSPACE_NAME;
  const demoRoot = path.join(getCtxhubHome(), 'demo-workspace');
  const configPath = path.join(demoRoot, '.ctxhub', 'config.yaml');

  // ── Idempotency check ────────────────────────────────────────────────────
  if (await pathExists(configPath)) {
    if (!opts.force) {
      console.log(chalk.yellow(`Demo workspace already exists at ${demoRoot}`));
      console.log(chalk.gray('Run with --force to overwrite.'));
      return;
    }
    console.log(chalk.gray('Overwriting existing demo workspace (--force)...'));
  }

  console.log(chalk.bold('\nScaffolding ctxhub demo workspace...\n'));

  // ── Create directory structure ───────────────────────────────────────────
  await ensureDir(demoRoot);
  await ensureDir(path.join(demoRoot, '.ctxhub', 'index'));
  await ensureDir(path.join(demoRoot, '.ctxhub', 'cache'));
  await ensureDir(path.join(demoRoot, '.ctxhub', 'memory'));
  await ensureDir(path.join(demoRoot, 'docs', 'decisions'));
  await ensureDir(path.join(demoRoot, 'docs', 'runbooks'));

  // ── Write markdown files ─────────────────────────────────────────────────
  for (const doc of DEMO_DOCS) {
    const abs = path.join(demoRoot, doc.rel);
    await writeText(abs, doc.content);
  }
  console.log(chalk.green(`  ✓ Wrote ${DEMO_DOCS.length} sample documentation files`));

  // ── Write .ctxhubignore ──────────────────────────────────────────────────
  await writeText(path.join(demoRoot, '.ctxhubignore'), defaultCtxhubIgnoreContent());
  console.log(chalk.green('  ✓ Wrote .ctxhubignore'));

  // ── Git init the demo repo ───────────────────────────────────────────────
  // `demo-docs` is registered with path "." (demoRoot itself). Without a real git repo
  // here, `ctxhub repo hook demo-docs` (the Act 3 webhook demo step) fails outright, and
  // freshness/staleness checks never resolve a commit. Best-effort: a broken demo repo
  // shouldn't abort the whole scaffold, just degrade those two things gracefully.
  if (await isGitInstalled()) {
    try {
      await runGit(['init'], demoRoot);
      await runGit(['add', '-A'], demoRoot);
      await runGit(
        ['-c', 'user.email=demo@ctxhub.local', '-c', 'user.name=ctxhub demo', 'commit', '-m', 'Initial demo workspace'],
        demoRoot
      );
      console.log(chalk.green('  ✓ Initialised demo-docs as a git repo'));
    } catch {
      console.log(chalk.yellow('  ⚠ Could not git-init demo-docs — `ctxhub repo hook demo-docs` won\'t work'));
    }
  }

  // ── Write workspace config ───────────────────────────────────────────────
  const config: CtxhubConfig = {
    version: 1,
    workspace: { name: workspaceName },
    repositories: [
      {
        name: 'demo-docs',
        path: '.',
        include: ['docs/**/*.md'],
        exclude: [],
      },
    ],
    knowledge: {
      include: ['docs/**/*.md'],
      exclude: [],
    },
    memory: {
      provider: 'local-json',
      path: '.ctxhub/memory/data.json',
    },
    index: {
      provider: 'local-json',
      path: '.ctxhub/index/data.json',
      table: 'ctxhub_chunks',
      incremental: false,
      chunkSize: 1800,
    },
    hooks: {},
    privacy: {
      redactPatterns: [
        '(api[_-]?key|token|secret|password)\\s*[:=]\\s*[^\\s]+',
        'AKIA[0-9A-Z]{16}',
      ],
    },
    llm: { enabled: false, timeoutMs: 120_000 },
    executionProfiles: {},
  };

  await writeText(path.join(demoRoot, '.ctxhub', 'config.yaml'), yaml.dump(config, { lineWidth: 120 }));
  console.log(chalk.green('  ✓ Created workspace config'));

  // ── Register in the global registry ─────────────────────────────────────
  const registryPath = path.join(getCtxhubHome(), 'registry.json');
  const registry = await loadRegistry(registryPath);
  // Remove any existing entry for this demo workspace (in case of --force re-run)
  registry.workspaces = registry.workspaces.filter(
    e => path.resolve(e.path) !== path.resolve(demoRoot) && e.name !== workspaceName
  );
  const entry: WorkspaceRegistryEntry = {
    name: workspaceName,
    path: demoRoot,
    addedAt: new Date().toISOString(),
  };
  registry.workspaces.push(entry);
  await saveRegistry(registry, registryPath);
  console.log(chalk.green(`  ✓ Registered workspace "${workspaceName}"`));

  // ── Index the workspace ──────────────────────────────────────────────────
  console.log(chalk.bold('\nIndexing demo workspace...'));
  await indexWorkspace(demoRoot, true);

  // ── Promote two chunks to institutional tier ─────────────────────────────
  const { config: loadedConfig, workspaceRoot } = await loadWorkspaceConfig(demoRoot);
  const index = createIndexProvider(
    loadedConfig.index.provider,
    loadedConfig.index.path,
    loadedConfig.index.table,
    workspaceRoot
  );

  const allChunks = await index.recent(10_000);
  console.log(chalk.green(`  ✓ Indexed ${allChunks.length} chunk(s) from ${DEMO_DOCS.length} files`));

  const TARGET_FILES = [
    'docs/decisions/adr-001-database.md',
    'docs/runbooks/deploy.md',
  ];

  let promotions = 0;
  for (const targetFile of TARGET_FILES) {
    const match = allChunks.find(c => c.filePath === targetFile);
    if (!match) {
      console.log(chalk.yellow(`  ⚠ No chunk found for ${targetFile} — skipping promotion`));
      continue;
    }
    const updated: IndexedDocument = {
      ...match,
      trustTier: 'institutional',
      promotedAt: new Date().toISOString(),
      promotedBy: 'ctxhub demo',
      promotionReason: 'Demo workspace seed — promoted automatically by ctxhub demo',
    };
    await index.indexDocuments([updated]);
    console.log(chalk.green(`  ✓ Promoted "${match.title ?? match.filePath}" to institutional`));
    promotions++;
  }

  const featureSeed = await seedDemoFeatureData(workspaceName, demoRoot);
  console.log(chalk.green(`  ✓ Seeded ${featureSeed.knowledgeObjects} knowledge objects, ${featureSeed.captains} Captains, and ${featureSeed.events} timeline events`));

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(chalk.bold('\n── Demo workspace ready ──────────────────────────────────\n'));
  console.log(`  Workspace:  ${chalk.cyan(workspaceName)}`);
  console.log(`  Path:       ${chalk.gray(demoRoot)}`);
  console.log(`  Files:      ${chalk.white(String(DEMO_DOCS.length))} markdown documents`);
  console.log(`  Chunks:     ${chalk.white(String(allChunks.length))} indexed`);
  console.log(`  Promotions: ${chalk.blue(String(promotions))} chunk(s) elevated to institutional tier`);
  console.log(`  Features:   ${chalk.white(`${featureSeed.captains} Captains · ${featureSeed.captainRuns} runs · ${featureSeed.knowledgeObjects} knowledge objects · ${featureSeed.jobs} workflow`)}`);

  console.log('');
  console.log(chalk.dim('Files created:'));
  for (const doc of DEMO_DOCS) {
    console.log(chalk.dim(`  ~/.ctxhub/demo-workspace/${doc.rel}`));
  }

  console.log('');
  console.log(
    chalk.bold('Next: ') +
    'run ' +
    chalk.cyan('ctxhub dashboard') +
    ' to open Mission Control and see your demo workspace'
  );
  console.log('');
}
