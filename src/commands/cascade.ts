import {
  findRule,
  getRulesForOrg,
  loadCascadeRuleStore,
  saveCascadeRuleStore,
} from '../topology/cascadeRuleStore.js';
import { deriveRulesFromTopology } from '../topology/cascadeRuleStore.js';
import { loadTopologyStore } from '../topology/store.js';
import { loadGroupStore } from '../groups/store.js';
import type { CascadeRule } from '../topology/cascadeRules.js';

// ── cascade list ──────────────────────────────────────────────────────────────

export async function cascadeListCommand(opts: { orgId?: string }): Promise<void> {
  const store = await loadCascadeRuleStore();

  let rules = store.rules;
  if (opts.orgId) {
    rules = getRulesForOrg(store, opts.orgId.trim());
  }

  if (rules.length === 0) {
    console.log('No cascade rules found.');
    if (!opts.orgId) {
      console.log('Use: ctxhub cascade add --trigger-org <id> --target-org <id> --name <name>');
      console.log('Or:  ctxhub cascade derive  (auto-derive from topology)');
    }
    return;
  }

  const col1 = 8;
  const col2 = Math.max(4, ...rules.map(r => r.name.length));
  const col3 = Math.max(10, ...rules.map(r => r.triggerOrgId.length));
  const col4 = Math.max(9, ...rules.map(r => r.targetOrgId.length));
  const col5 = 8;

  console.log(
    `${'Id'.padEnd(col1)}  ${'Name'.padEnd(col2)}  ${'TriggerOrg'.padEnd(col3)}  ${'TargetOrg'.padEnd(col4)}  ${'Basis'.padEnd(col5)}  Active`
  );
  console.log(
    `${'-'.repeat(col1)}  ${'-'.repeat(col2)}  ${'-'.repeat(col3)}  ${'-'.repeat(col4)}  ${'-'.repeat(col5)}  ------`
  );

  for (const r of rules) {
    console.log(
      `${r.id.substring(0, 8)}  ${r.name.padEnd(col2)}  ${r.triggerOrgId.padEnd(col3)}  ${r.targetOrgId.padEnd(col4)}  ${r.basis.padEnd(col5)}  ${r.active}`
    );
  }
}

// ── cascade add ───────────────────────────────────────────────────────────────

export async function cascadeAddCommand(opts: {
  triggerOrg: string;
  targetOrg: string;
  name: string;
  tags?: string;
  workspace?: string;
}): Promise<void> {
  if (!opts.triggerOrg?.trim()) { console.error('Error: --trigger-org is required'); process.exit(1); }
  if (!opts.targetOrg?.trim()) { console.error('Error: --target-org is required'); process.exit(1); }
  if (!opts.name?.trim()) { console.error('Error: --name is required'); process.exit(1); }

  const store = await loadCascadeRuleStore();

  const rule: CascadeRule = {
    id: crypto.randomUUID(),
    name: opts.name.trim(),
    triggerOrgId: opts.triggerOrg.trim(),
    targetOrgId: opts.targetOrg.trim(),
    triggerTags: opts.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    targetWorkspace: opts.workspace?.trim() || undefined,
    basis: 'manual',
    createdAt: new Date().toISOString(),
    createdBy: 'cli',
    active: true,
  };

  store.rules.push(rule);
  await saveCascadeRuleStore(store);

  console.log(`Added cascade rule:`);
  console.log(`  id:          ${rule.id.substring(0, 8)}`);
  console.log(`  name:        ${rule.name}`);
  console.log(`  triggerOrg:  ${rule.triggerOrgId}`);
  console.log(`  targetOrg:   ${rule.targetOrgId}`);
  console.log(`  basis:       manual`);
  if (rule.triggerTags?.length) console.log(`  tags:        ${rule.triggerTags.join(', ')}`);
  if (rule.targetWorkspace) console.log(`  workspace:   ${rule.targetWorkspace}`);
}

// ── cascade remove ────────────────────────────────────────────────────────────

export async function cascadeRemoveCommand(id: string): Promise<void> {
  if (!id?.trim()) {
    console.error('Error: rule id argument is required');
    process.exit(1);
  }

  const store = await loadCascadeRuleStore();
  const rule = findRule(store, id.trim());

  if (!rule) {
    console.error(`Error: No cascade rule with id "${id}"`);
    process.exit(1);
  }

  store.rules = store.rules.filter(r => r.id !== rule.id);
  await saveCascadeRuleStore(store);
  console.log(`Removed cascade rule: ${rule.name} (${rule.id.substring(0, 8)})`);
}

// ── cascade derive ────────────────────────────────────────────────────────────

export async function cascadeDeriveCommand(opts: { yes?: boolean }): Promise<void> {
  const topologyStore = await loadTopologyStore();
  const groupStore = await loadGroupStore();

  const derived = deriveRulesFromTopology(topologyStore, groupStore);

  if (derived.length === 0) {
    console.log('No cross-org depends_on edges found in topology.');
    console.log('Add services to different org workspaces and connect them with:');
    console.log('  ctxhub topology edge add --from <id> --from-type service --to <id> --to-type service --type depends_on');
    return;
  }

  console.log(`Found ${derived.length} cross-org depends_on edge(s):`);
  for (const r of derived) {
    console.log(`  ${r.triggerOrgId} → ${r.targetOrgId}  (edge: ${r.topologyEdgeId?.substring(0, 8) ?? 'unknown'})`);
  }

  if (!opts.yes) {
    console.log(`\nRun with --yes to save these ${derived.length} rule(s).`);
    return;
  }

  // Load existing store and merge (skip duplicates by topologyEdgeId)
  const store = await loadCascadeRuleStore();
  const existingEdgeIds = new Set(
    store.rules.filter(r => r.topologyEdgeId).map(r => r.topologyEdgeId!)
  );

  let added = 0;
  for (const rule of derived) {
    if (rule.topologyEdgeId && existingEdgeIds.has(rule.topologyEdgeId)) {
      continue; // already exists
    }
    store.rules.push(rule);
    added++;
  }

  await saveCascadeRuleStore(store);
  console.log(`Saved ${added} new cascade rule(s) (${derived.length - added} already existed).`);
}
