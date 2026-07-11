import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { Concept, KnowledgeEdge, KnowledgeObject, KnowledgeObjectState, KnowledgeStore } from './types.js';

export function getKnowledgeStorePath(workspaceId: string): string {
  return path.join(getCtxhubHome(), 'knowledge', `${workspaceId}.json`);
}

export async function loadKnowledgeStore(
  workspaceId: string,
  storePath = getKnowledgeStorePath(workspaceId),
): Promise<KnowledgeStore> {
  if (!(await pathExists(storePath))) {
    return { version: 1, objects: [], edges: [], concepts: [] };
  }
  const raw = await readText(storePath);
  const parsed = JSON.parse(raw) as Partial<KnowledgeStore>;
  return { version: 1, objects: parsed.objects ?? [], edges: parsed.edges ?? [], concepts: parsed.concepts ?? [] };
}

export async function saveKnowledgeStore(
  workspaceId: string,
  store: KnowledgeStore,
  storePath = getKnowledgeStorePath(workspaceId),
): Promise<void> {
  await writeText(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function findKnowledgeObject(store: KnowledgeStore, id: string): KnowledgeObject | undefined {
  // Support full id or prefix match (at least 8 chars)
  return store.objects.find(o => o.id === id || o.id.startsWith(id));
}

export function listKnowledgeObjects(
  store: KnowledgeStore,
  filter?: { state?: KnowledgeObjectState; tag?: string },
): KnowledgeObject[] {
  let objects = store.objects;
  if (filter?.state) {
    objects = objects.filter(o => o.state === filter.state);
  }
  if (filter?.tag) {
    const tag = filter.tag;
    objects = objects.filter(o => o.tags?.includes(tag));
  }
  return objects;
}

// ── Edge helpers ──────────────────────────────────────────────────────────────

export function findEdge(store: KnowledgeStore, id: string): KnowledgeEdge | undefined {
  return store.edges.find(e => e.id === id || e.id.startsWith(id));
}

export function getEdgesForObject(store: KnowledgeStore, objectId: string): KnowledgeEdge[] {
  return store.edges.filter(e => e.fromId === objectId || e.toId === objectId);
}

// ── Concept helpers ───────────────────────────────────────────────────────────

export function findConcept(store: KnowledgeStore, id: string): Concept | undefined {
  return store.concepts.find(c => c.id === id || c.id.startsWith(id));
}

export function findConceptByName(store: KnowledgeStore, name: string): Concept | undefined {
  return store.concepts.find(c => c.name.toLowerCase() === name.toLowerCase());
}

export function getObjectsForConcept(store: KnowledgeStore, conceptId: string): string[] {
  const concept = findConcept(store, conceptId);
  return concept?.relatedObjectIds ?? [];
}
