import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { TopologyEdge, TopologyRepository, TopologyService, TopologyStore } from './types.js';

export function getTopologyStorePath(): string {
  return path.join(getCtxhubHome(), 'topology.json');
}

export async function loadTopologyStore(storePath = getTopologyStorePath()): Promise<TopologyStore> {
  if (!(await pathExists(storePath))) {
    return { version: 1, repositories: [], services: [], edges: [] };
  }
  const raw = await readText(storePath);
  const parsed = JSON.parse(raw) as Partial<TopologyStore>;
  return {
    version: 1,
    repositories: parsed.repositories ?? [],
    services: parsed.services ?? [],
    edges: parsed.edges ?? [],
  };
}

export async function saveTopologyStore(
  store: TopologyStore,
  storePath = getTopologyStorePath(),
): Promise<void> {
  await writeText(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

// ── Pure query helpers ────────────────────────────────────────────────────────

export function findRepository(store: TopologyStore, id: string): TopologyRepository | undefined {
  return store.repositories.find(r => r.id === id || r.id.startsWith(id));
}

export function findService(store: TopologyStore, id: string): TopologyService | undefined {
  return store.services.find(s => s.id === id || s.id.startsWith(id));
}

export function getEdgesFrom(store: TopologyStore, id: string): TopologyEdge[] {
  return store.edges.filter(e => e.fromId === id);
}

export function getEdgesTo(store: TopologyStore, id: string): TopologyEdge[] {
  return store.edges.filter(e => e.toId === id);
}

/**
 * BFS following depends_on edges from serviceId up to maxDepth.
 * Returns a flat list of {serviceId, depth} entries (no cycles).
 */
export function getTransitiveDependencies(
  store: TopologyStore,
  serviceId: string,
  maxDepth = 3,
): Array<{ id: string; depth: number }> {
  const visited = new Set<string>([serviceId]);
  const result: Array<{ id: string; depth: number }> = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: serviceId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const outgoing = store.edges.filter(
      e => e.fromId === current.id && e.edgeType === 'depends_on',
    );

    for (const edge of outgoing) {
      if (!visited.has(edge.toId)) {
        visited.add(edge.toId);
        const nextDepth = current.depth + 1;
        result.push({ id: edge.toId, depth: nextDepth });
        queue.push({ id: edge.toId, depth: nextDepth });
      }
    }
  }

  return result;
}
