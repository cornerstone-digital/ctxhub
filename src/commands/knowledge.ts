import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { listWorkspaces } from '../workspaces/registry.js';
import {
  loadKnowledgeStore,
  saveKnowledgeStore,
  findKnowledgeObject,
  listKnowledgeObjects,
  getEdgesForObject,
  findConcept,
  findConceptByName,
} from '../knowledge/store.js';
import type { KnowledgeEdge, KnowledgeEdgeType, Concept, KnowledgeObject, KnowledgeObjectState } from '../knowledge/types.js';
import { searchDecisions, formatDecisionResults } from '../knowledge/decisionSearch.js';
import { computeVelocity } from '../knowledge/velocity.js';

// Resolve the workspace ID (name) from the --workspace option or from cwd.
async function resolveWorkspaceId(workspace?: string): Promise<string> {
  if (workspace) {
    const workspaces = await listWorkspaces();
    const ws = workspaces.find(w => w.name === workspace);
    if (!ws) {
      console.error(chalk.red(`No registered workspace named "${workspace}". Run: ctxhub workspace list`));
      process.exit(1);
    }
    return ws.name;
  }
  const { config } = await loadWorkspaceConfig();
  return config.workspace.name;
}

// ── knowledge create ──────────────────────────────────────────────────────────

export async function knowledgeCreateCommand(opts: {
  title: string;
  content: string;
  workspace?: string;
  tags?: string;
}): Promise<void> {
  if (!opts.title?.trim()) {
    console.error(chalk.red('Error: --title is required'));
    process.exit(1);
  }
  if (!opts.content?.trim()) {
    console.error(chalk.red('Error: --content is required'));
    process.exit(1);
  }

  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const now = new Date().toISOString();
  const ko: KnowledgeObject = {
    id: crypto.randomUUID(),
    workspaceId,
    title: opts.title.trim(),
    content: opts.content.trim(),
    state: 'draft',
    confidence: 0.5,
    corroborations: [],
    createdAt: now,
    updatedAt: now,
    createdBy: 'cli',
    ...(opts.tags ? { tags: opts.tags.split(',').map(t => t.trim()).filter(Boolean) } : {}),
  };

  store.objects.push(ko);
  await saveKnowledgeStore(workspaceId, store);

  console.log(chalk.green(`✓ Created knowledge object ${ko.id}`));
}

// ── knowledge list ────────────────────────────────────────────────────────────

export async function knowledgeListCommand(opts: {
  workspace?: string;
  state?: string;
  tag?: string;
}): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const state = opts.state as KnowledgeObjectState | undefined;
  const objects = listKnowledgeObjects(store, { state, tag: opts.tag });

  if (!objects.length) {
    console.log(chalk.yellow('No knowledge objects. Create one with: ctxhub knowledge create'));
    return;
  }

  const stateColor = (s: KnowledgeObjectState): string => {
    switch (s) {
      case 'active': return chalk.green(s);
      case 'draft': return chalk.yellow(s);
      case 'superseded': return chalk.gray(s);
      case 'archived': return chalk.dim(s);
    }
  };

  const pad = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);

  console.log(`${'ID'.padEnd(10)} ${'TITLE'.padEnd(42)} ${'STATE'.padEnd(12)} ${'CONF'.padEnd(6)} UPDATED`);
  console.log('─'.repeat(90));

  for (const ko of objects) {
    const id = ko.id.slice(0, 8);
    const title = pad(ko.title, 40);
    const state2 = stateColor(ko.state);
    const conf = ko.confidence.toFixed(2);
    const updated = ko.updatedAt.slice(0, 10);
    console.log(`${id}   ${title}   ${state2.padEnd(20)}  ${conf}  ${updated}`);
  }
}

// ── knowledge promote ─────────────────────────────────────────────────────────

export async function knowledgePromoteCommand(id: string, opts: { workspace?: string }): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const ko = findKnowledgeObject(store, id);
  if (!ko) {
    console.error(chalk.red(`No knowledge object found with id "${id}"`));
    process.exit(1);
  }

  if (ko.state !== 'draft') {
    console.error(chalk.red(`Cannot promote: knowledge object is in state "${ko.state}" (must be "draft")`));
    process.exit(1);
  }

  ko.state = 'active';
  ko.updatedAt = new Date().toISOString();
  await saveKnowledgeStore(workspaceId, store);

  console.log(chalk.green(`✓ Promoted knowledge object ${ko.id.slice(0, 8)} to active`));
}

// ── knowledge supersede ───────────────────────────────────────────────────────

export async function knowledgeSupersededCommand(
  id: string,
  opts: { by: string; workspace?: string },
): Promise<void> {
  if (!opts.by) {
    console.error(chalk.red('Error: --by <new-id> is required'));
    process.exit(1);
  }

  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const ko = findKnowledgeObject(store, id);
  if (!ko) {
    console.error(chalk.red(`No knowledge object found with id "${id}"`));
    process.exit(1);
  }

  const newKo = findKnowledgeObject(store, opts.by);
  if (!newKo) {
    console.error(chalk.red(`No knowledge object found with id "${opts.by}" (--by)`));
    process.exit(1);
  }

  ko.state = 'superseded';
  ko.supersededBy = newKo.id;
  ko.updatedAt = new Date().toISOString();
  await saveKnowledgeStore(workspaceId, store);

  console.log(chalk.green(`✓ Marked ${ko.id.slice(0, 8)} as superseded by ${newKo.id.slice(0, 8)}`));
}

// ── knowledge archive ─────────────────────────────────────────────────────────

export async function knowledgeArchiveCommand(
  id: string,
  opts: { reason?: string; workspace?: string },
): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const ko = findKnowledgeObject(store, id);
  if (!ko) {
    console.error(chalk.red(`No knowledge object found with id "${id}"`));
    process.exit(1);
  }

  ko.state = 'archived';
  ko.updatedAt = new Date().toISOString();
  if (opts.reason) ko.archiveReason = opts.reason;
  await saveKnowledgeStore(workspaceId, store);

  console.log(chalk.green(`✓ Archived knowledge object ${ko.id.slice(0, 8)}`));
  if (opts.reason) console.log(chalk.gray(`  Reason: ${opts.reason}`));
}

// ── knowledge flag ────────────────────────────────────────────────────────────

export async function knowledgeFlagCommand(id: string, opts: { workspace?: string }): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const ko = findKnowledgeObject(store, id);
  if (!ko) {
    console.error(chalk.red(`No knowledge object found with id "${id}"`));
    process.exit(1);
  }

  ko.reviewFlag = !ko.reviewFlag;
  ko.updatedAt = new Date().toISOString();
  await saveKnowledgeStore(workspaceId, store);

  const flagState = ko.reviewFlag ? chalk.yellow('flagged for review') : chalk.green('unflagged');
  console.log(`Knowledge object ${ko.id.slice(0, 8)}: ${flagState}`);
}

// ── knowledge show ────────────────────────────────────────────────────────────

export async function knowledgeShowCommand(id: string, opts: { workspace?: string }): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const ko = findKnowledgeObject(store, id);
  if (!ko) {
    console.error(chalk.red(`No knowledge object found with id "${id}"`));
    process.exit(1);
  }

  console.log(chalk.bold(`Knowledge Object: ${ko.id}`));
  console.log(`  Title:          ${ko.title}`);
  console.log(`  State:          ${ko.state}`);
  console.log(`  Confidence:     ${ko.confidence}`);
  console.log(`  Workspace:      ${ko.workspaceId}`);
  console.log(`  Created:        ${ko.createdAt}`);
  console.log(`  Updated:        ${ko.updatedAt}`);
  console.log(`  Created By:     ${ko.createdBy}`);
  if (ko.tags?.length) console.log(`  Tags:           ${ko.tags.join(', ')}`);
  if (ko.sourceChunkId) console.log(`  Source Chunk:   ${ko.sourceChunkId}`);
  if (ko.corroborations.length) console.log(`  Corroborations: ${ko.corroborations.join(', ')}`);
  if (ko.reviewFlag) console.log(`  Review Flag:    ${chalk.yellow('YES — flagged for human review')}`);
  if (ko.supersededBy) console.log(`  Superseded By:  ${ko.supersededBy}`);
  if (ko.archiveReason) console.log(`  Archive Reason: ${ko.archiveReason}`);
  console.log('');
  console.log(chalk.bold('Content:'));
  console.log(ko.content);
}

// ── knowledge edge add ─────────────────────────────────────────────────────────

export async function knowledgeEdgeAddCommand(opts: {
  from: string;
  to: string;
  type: string;
  description?: string;
  confidence?: number;
  workspace?: string;
}): Promise<void> {
  if (!opts.from?.trim()) { console.error(chalk.red('Error: --from is required')); process.exit(1); }
  if (!opts.to?.trim()) { console.error(chalk.red('Error: --to is required')); process.exit(1); }

  const validTypes: KnowledgeEdgeType[] = ['supports', 'contradicts', 'supersedes', 'related_to', 'derived_from'];
  if (!validTypes.includes(opts.type as KnowledgeEdgeType)) {
    console.error(chalk.red(`Error: --type must be one of: ${validTypes.join(', ')}`));
    process.exit(1);
  }

  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const fromKo = findKnowledgeObject(store, opts.from);
  if (!fromKo) { console.error(chalk.red(`No knowledge object found with id "${opts.from}"`)); process.exit(1); }
  const toKo = findKnowledgeObject(store, opts.to);
  if (!toKo) { console.error(chalk.red(`No knowledge object found with id "${opts.to}"`)); process.exit(1); }

  const edge: KnowledgeEdge = {
    id: crypto.randomUUID(),
    fromId: fromKo.id,
    toId: toKo.id,
    edgeType: opts.type as KnowledgeEdgeType,
    description: opts.description,
    confidence: opts.confidence ?? 1.0,
    createdAt: new Date().toISOString(),
    createdBy: 'cli',
  };

  store.edges.push(edge);
  await saveKnowledgeStore(workspaceId, store);
  console.log(chalk.green(`✓ Created edge ${edge.id.slice(0, 8)}: ${fromKo.id.slice(0, 8)} --[${edge.edgeType}]--> ${toKo.id.slice(0, 8)}`));
}

// ── knowledge edge list ────────────────────────────────────────────────────────

export async function knowledgeEdgeListCommand(opts: {
  object?: string;
  workspace?: string;
}): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const edges = opts.object ? getEdgesForObject(store, opts.object) : store.edges;
  if (!edges.length) {
    console.log(chalk.yellow('No edges found.'));
    return;
  }

  console.log(`${'ID'.padEnd(10)} ${'FROM'.padEnd(10)} ${'TO'.padEnd(10)} ${'TYPE'.padEnd(14)} CONF`);
  console.log('─'.repeat(60));
  for (const e of edges) {
    console.log(`${e.id.slice(0, 8)}   ${e.fromId.slice(0, 8)}   ${e.toId.slice(0, 8)}   ${e.edgeType.padEnd(14)}  ${e.confidence.toFixed(2)}`);
  }
}

// ── knowledge concept add ──────────────────────────────────────────────────────

export async function knowledgeConceptAddCommand(opts: {
  name: string;
  description?: string;
  workspace?: string;
}): Promise<void> {
  if (!opts.name?.trim()) { console.error(chalk.red('Error: --name is required')); process.exit(1); }

  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  if (findConceptByName(store, opts.name.trim())) {
    console.error(chalk.red(`A concept named "${opts.name.trim()}" already exists.`));
    process.exit(1);
  }

  const now = new Date().toISOString();
  const concept: Concept = {
    id: crypto.randomUUID(),
    name: opts.name.trim(),
    description: opts.description,
    relatedObjectIds: [],
    createdAt: now,
    updatedAt: now,
  };

  store.concepts.push(concept);
  await saveKnowledgeStore(workspaceId, store);
  console.log(chalk.green(`✓ Created concept ${concept.id.slice(0, 8)}: "${concept.name}"`));
}

// ── knowledge concept link ─────────────────────────────────────────────────────

export async function knowledgeConceptLinkCommand(opts: {
  concept: string;
  object: string;
  workspace?: string;
}): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const concept = findConcept(store, opts.concept);
  if (!concept) { console.error(chalk.red(`No concept found with id "${opts.concept}"`)); process.exit(1); }

  const ko = findKnowledgeObject(store, opts.object);
  if (!ko) { console.error(chalk.red(`No knowledge object found with id "${opts.object}"`)); process.exit(1); }

  if (concept.relatedObjectIds.includes(ko.id)) {
    console.log(chalk.yellow(`Object ${ko.id.slice(0, 8)} is already linked to concept "${concept.name}".`));
    return;
  }

  concept.relatedObjectIds.push(ko.id);
  concept.updatedAt = new Date().toISOString();
  await saveKnowledgeStore(workspaceId, store);
  console.log(chalk.green(`✓ Linked object ${ko.id.slice(0, 8)} to concept "${concept.name}"`));
}

// ── knowledge concept list ─────────────────────────────────────────────────────

export async function knowledgeConceptListCommand(opts: { workspace?: string }): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  if (!store.concepts.length) {
    console.log(chalk.yellow('No concepts. Create one with: ctxhub knowledge concept add --name <name>'));
    return;
  }

  console.log(`${'ID'.padEnd(10)} ${'NAME'.padEnd(30)} OBJECTS`);
  console.log('─'.repeat(55));
  for (const c of store.concepts) {
    console.log(`${c.id.slice(0, 8)}   ${c.name.padEnd(30)}  ${c.relatedObjectIds.length}`);
  }
}

// ── knowledge search ───────────────────────────────────────────────────────────

export async function knowledgeSearchCommand(
  query: string,
  opts: {
    workspace?: string;
    minConfidence?: number;
    includeArchived?: boolean;
  },
): Promise<void> {
  if (!query?.trim()) { console.error(chalk.red('Error: query is required')); process.exit(1); }

  const results = await searchDecisions(query, {
    workspaceId: opts.workspace,
    minConfidence: opts.minConfidence,
    includeArchived: opts.includeArchived,
  });

  console.log(formatDecisionResults(results));
}

// ── knowledge velocity ─────────────────────────────────────────────────────────

export async function knowledgeVelocityCommand(opts: {
  workspace?: string;
  from?: string;
  to?: string;
  bucket?: string;
}): Promise<void> {
  const workspaceId = await resolveWorkspaceId(opts.workspace);
  const store = await loadKnowledgeStore(workspaceId);

  const toDate = opts.to ? new Date(opts.to) : new Date();
  const fromDate = opts.from
    ? new Date(opts.from)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000); // last 30 days

  const bucketSize = (opts.bucket === 'week' ? 'week' : 'day') as 'day' | 'week';

  const report = computeVelocity(store.objects, fromDate, toDate, bucketSize, workspaceId);

  console.log(chalk.bold(`Knowledge velocity: ${workspaceId} (${report.period.from} → ${report.period.to})\n`));
  console.log(`${'Date'.padEnd(12)} ${'Created'.padStart(8)} ${'Active'.padStart(8)} ${'Archived'.padStart(9)} ${'Superseded'.padStart(11)}`);
  console.log('─'.repeat(52));

  for (const b of report.buckets) {
    console.log(
      `${b.date.padEnd(12)} ${String(b.created).padStart(8)} ${String(b.promoted).padStart(8)} ${String(b.archived).padStart(9)} ${String(b.superseded).padStart(11)}`,
    );
  }

  console.log('─'.repeat(52));
  console.log(
    `${'Totals:'.padEnd(12)} ${String(report.totals.created).padStart(8)} ${String(report.totals.promoted).padStart(8)} ${String(report.totals.archived).padStart(9)} ${String(report.totals.superseded).padStart(11)}`,
  );

  const trendSymbol = report.trend === 'growing' ? '↑' : report.trend === 'declining' ? '↓' : '→';
  console.log(chalk.bold(`\nTrend: ${trendSymbol} ${report.trend}`));
}
