import {
  findRepository,
  findService,
  getEdgesFrom,
  getTransitiveDependencies,
  loadTopologyStore,
  saveTopologyStore,
} from '../topology/store.js';
import type { TopologyEdgeType } from '../topology/types.js';

const VALID_EDGE_TYPES: TopologyEdgeType[] = [
  'depends_on',
  'calls',
  'owns',
  'deployed_with',
  'shares_db',
];

// ── topology repo add ─────────────────────────────────────────────────────────

export async function topologyRepoAddCommand(opts: {
  name: string;
  url?: string;
  workspace?: string;
  lang?: string;
  tags?: string;
}): Promise<void> {
  if (!opts.name?.trim()) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  const store = await loadTopologyStore();

  const repo = {
    id: crypto.randomUUID(),
    name: opts.name.trim(),
    url: opts.url?.trim() || undefined,
    workspaceId: opts.workspace?.trim() || undefined,
    language: opts.lang?.trim() || undefined,
    tags: opts.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    addedAt: new Date().toISOString(),
    addedBy: 'cli',
  };

  store.repositories.push(repo);
  await saveTopologyStore(store);

  console.log(`Added repository:`);
  console.log(`  id:   ${repo.id.substring(0, 8)}`);
  console.log(`  name: ${repo.name}`);
  if (repo.language) console.log(`  lang: ${repo.language}`);
  if (repo.workspaceId) console.log(`  workspace: ${repo.workspaceId}`);
}

// ── topology repo list ────────────────────────────────────────────────────────

export async function topologyRepoListCommand(): Promise<void> {
  const store = await loadTopologyStore();

  if (store.repositories.length === 0) {
    console.log('No repositories. Use: ctxhub topology repo add --name <name>');
    return;
  }

  const col1 = 8;
  const col2 = Math.max(4, ...store.repositories.map(r => r.name.length));
  const col3 = Math.max(8, ...store.repositories.map(r => (r.language ?? '').length));
  const col4 = Math.max(9, ...store.repositories.map(r => (r.workspaceId ?? '').length));

  console.log(
    `${'Id'.padEnd(col1)}  ${'Name'.padEnd(col2)}  ${'Language'.padEnd(col3)}  ${'Workspace'.padEnd(col4)}  Tags`
  );
  console.log(
    `${'-'.repeat(col1)}  ${'-'.repeat(col2)}  ${'-'.repeat(col3)}  ${'-'.repeat(col4)}  ----`
  );

  for (const r of store.repositories) {
    console.log(
      `${r.id.substring(0, 8)}  ${r.name.padEnd(col2)}  ${(r.language ?? '').padEnd(col3)}  ${(r.workspaceId ?? '').padEnd(col4)}  ${(r.tags ?? []).join(', ')}`
    );
  }
}

// ── topology service add ──────────────────────────────────────────────────────

export async function topologyServiceAddCommand(opts: {
  name: string;
  type?: string;
  repo?: string;
  description?: string;
  tags?: string;
}): Promise<void> {
  if (!opts.name?.trim()) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  const store = await loadTopologyStore();

  const service = {
    id: crypto.randomUUID(),
    name: opts.name.trim(),
    type: opts.type?.trim() || undefined,
    repositoryId: opts.repo?.trim() || undefined,
    description: opts.description?.trim() || undefined,
    tags: opts.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    addedAt: new Date().toISOString(),
    addedBy: 'cli',
  };

  store.services.push(service);
  await saveTopologyStore(store);

  console.log(`Added service:`);
  console.log(`  id:   ${service.id.substring(0, 8)}`);
  console.log(`  name: ${service.name}`);
  if (service.type) console.log(`  type: ${service.type}`);
  if (service.repositoryId) console.log(`  repo: ${service.repositoryId}`);
}

// ── topology service list ─────────────────────────────────────────────────────

export async function topologyServiceListCommand(): Promise<void> {
  const store = await loadTopologyStore();

  if (store.services.length === 0) {
    console.log('No services. Use: ctxhub topology service add --name <name>');
    return;
  }

  const col1 = 8;
  const col2 = Math.max(4, ...store.services.map(s => s.name.length));
  const col3 = Math.max(4, ...store.services.map(s => (s.type ?? '').length));

  console.log(
    `${'Id'.padEnd(col1)}  ${'Name'.padEnd(col2)}  ${'Type'.padEnd(col3)}  Repo`
  );
  console.log(
    `${'-'.repeat(col1)}  ${'-'.repeat(col2)}  ${'-'.repeat(col3)}  ----`
  );

  for (const s of store.services) {
    const repoName = s.repositoryId
      ? (store.repositories.find(r => r.id === s.repositoryId)?.name ?? s.repositoryId.substring(0, 8))
      : '';
    console.log(
      `${s.id.substring(0, 8)}  ${s.name.padEnd(col2)}  ${(s.type ?? '').padEnd(col3)}  ${repoName}`
    );
  }
}

// ── topology edge add ─────────────────────────────────────────────────────────

export async function topologyEdgeAddCommand(opts: {
  from: string;
  fromType: string;
  to: string;
  toType: string;
  type: string;
  description?: string;
}): Promise<void> {
  const missingFields: string[] = [];
  if (!opts.from?.trim()) missingFields.push('--from');
  if (!opts.fromType?.trim()) missingFields.push('--from-type');
  if (!opts.to?.trim()) missingFields.push('--to');
  if (!opts.toType?.trim()) missingFields.push('--to-type');
  if (!opts.type?.trim()) missingFields.push('--type');

  if (missingFields.length > 0) {
    console.error(`Error: ${missingFields.join(', ')} is required`);
    process.exit(1);
  }

  if (!['service', 'repository'].includes(opts.fromType)) {
    console.error('Error: --from-type must be "service" or "repository"');
    process.exit(1);
  }

  if (!['service', 'repository'].includes(opts.toType)) {
    console.error('Error: --to-type must be "service" or "repository"');
    process.exit(1);
  }

  if (!VALID_EDGE_TYPES.includes(opts.type as TopologyEdgeType)) {
    console.error(`Error: --type must be one of: ${VALID_EDGE_TYPES.join(', ')}`);
    process.exit(1);
  }

  const store = await loadTopologyStore();

  // --from/--to are accepted as full ids or prefixes (matching the display convention of
  // `service add`/`repo add`, which only ever prints an 8-char id back to the user). Resolve
  // to the canonical stored id here so edges never silently point at a dangling reference that
  // downstream lookups (getEdgesFrom, getTransitiveDependencies) can't find via strict equality.
  const fromNode = opts.fromType === 'service' ? findService(store, opts.from.trim()) : findRepository(store, opts.from.trim());
  if (!fromNode) {
    console.error(`Error: No ${opts.fromType} found with id "${opts.from}"`);
    process.exit(1);
  }
  const toNode = opts.toType === 'service' ? findService(store, opts.to.trim()) : findRepository(store, opts.to.trim());
  if (!toNode) {
    console.error(`Error: No ${opts.toType} found with id "${opts.to}"`);
    process.exit(1);
  }

  const edge = {
    id: crypto.randomUUID(),
    fromId: fromNode.id,
    fromType: opts.fromType as 'service' | 'repository',
    toId: toNode.id,
    toType: opts.toType as 'service' | 'repository',
    edgeType: opts.type as TopologyEdgeType,
    description: opts.description?.trim() || undefined,
    addedAt: new Date().toISOString(),
    addedBy: 'cli',
  };

  store.edges.push(edge);
  await saveTopologyStore(store);

  console.log(`Added edge:`);
  console.log(`  id:   ${edge.id.substring(0, 8)}`);
  console.log(`  ${edge.fromType}:${edge.fromId.substring(0, 8)} --[${edge.edgeType}]--> ${edge.toType}:${edge.toId.substring(0, 8)}`);
}

// ── topology edge list ────────────────────────────────────────────────────────

export async function topologyEdgeListCommand(opts: { from?: string }): Promise<void> {
  const store = await loadTopologyStore();

  let edges = store.edges;
  if (opts.from) {
    const node = findService(store, opts.from.trim()) ?? findRepository(store, opts.from.trim());
    edges = getEdgesFrom(store, node ? node.id : opts.from.trim());
  }

  if (edges.length === 0) {
    console.log('No edges found.');
    return;
  }

  const col1 = 8;
  const col2 = Math.max(8, ...edges.map(e => e.fromId.substring(0, 8).length + 1 + e.fromType.length));
  const col3 = Math.max(11, ...edges.map(e => e.edgeType.length));
  const col4 = Math.max(6, ...edges.map(e => e.toId.substring(0, 8).length + 1 + e.toType.length));

  console.log(
    `${'Id'.padEnd(col1)}  ${'From'.padEnd(col2)}  ${'Edge Type'.padEnd(col3)}  To`
  );
  console.log(
    `${'-'.repeat(col1)}  ${'-'.repeat(col2)}  ${'-'.repeat(col3)}  ${'-'.repeat(col4)}`
  );

  for (const e of edges) {
    const from = `${e.fromType}:${e.fromId.substring(0, 8)}`;
    const to = `${e.toType}:${e.toId.substring(0, 8)}`;
    console.log(
      `${e.id.substring(0, 8)}  ${from.padEnd(col2)}  ${e.edgeType.padEnd(col3)}  ${to}`
    );
  }
}

// ── topology deps ─────────────────────────────────────────────────────────────

export async function topologyDepsCommand(serviceId: string): Promise<void> {
  if (!serviceId?.trim()) {
    console.error('Error: service-id argument is required');
    process.exit(1);
  }

  const store = await loadTopologyStore();
  const root = findService(store, serviceId.trim());

  if (!root) {
    console.error(`Error: No service found with id "${serviceId}"`);
    process.exit(1);
  }

  const deps = getTransitiveDependencies(store, root.id);

  console.log(`${root.name} (${root.id.substring(0, 8)})`);

  if (deps.length === 0) {
    console.log('  (no depends_on edges)');
    return;
  }

  // Build an indented ASCII tree
  // Group by depth to track which items are "last" at each level
  function printDepsTree(nodeId: string, depth: number, prefix: string): void {
    const children = store.edges.filter(
      e => e.fromId === nodeId && e.edgeType === 'depends_on',
    );

    children.forEach((edge, i) => {
      const isLast = i === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childService = findService(store, edge.toId);
      const childLabel = childService
        ? `${childService.name} (${edge.toId.substring(0, 8)})`
        : `${edge.toId.substring(0, 8)}`;

      console.log(`${prefix}${connector}${childLabel}`);

      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      if (depth < 3) {
        printDepsTree(edge.toId, depth + 1, nextPrefix);
      }
    });
  }

  printDepsTree(root.id, 0, '');
}

// ── topology show ─────────────────────────────────────────────────────────────

export async function topologyShowCommand(): Promise<void> {
  const store = await loadTopologyStore();

  if (store.services.length === 0 && store.repositories.length === 0) {
    console.log('No topology data. Use: ctxhub topology repo add / service add');
    return;
  }

  console.log('=== Topology ===\n');

  if (store.services.length > 0) {
    console.log('Services:');
    for (const s of store.services) {
      const edges = getEdgesFrom(store, s.id);
      const typeLabel = s.type ? ` [${s.type}]` : '';
      console.log(`  ${s.name}${typeLabel} (${s.id.substring(0, 8)})`);
      for (const e of edges) {
        const target = findService(store, e.toId) ?? findRepository(store, e.toId);
        const targetLabel = target ? target.name : e.toId.substring(0, 8);
        console.log(`    --[${e.edgeType}]--> ${targetLabel}`);
      }
    }
  }

  if (store.repositories.length > 0) {
    console.log('\nRepositories:');
    for (const r of store.repositories) {
      const langLabel = r.language ? ` [${r.language}]` : '';
      console.log(`  ${r.name}${langLabel} (${r.id.substring(0, 8)})`);
    }
  }
}
