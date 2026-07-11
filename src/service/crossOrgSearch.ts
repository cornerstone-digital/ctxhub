import { resolveOrgForUser, canSearchCrossOrg } from '../groups/groups.js';
import { findOrgsByGroup } from '../groups/store.js';
import type { GroupStore } from '../groups/types.js';
import type { Principal } from '../auth/types.js';

export type SearchResult = Record<string, unknown>;

export interface CrossOrgSearchResult {
  results: SearchResult[];
  sources: {
    local: number;
    peers: Record<string, number>;
  };
}

/**
 * Fan out a search to permitted peer org instances and merge with local results.
 *
 * @param q - The search query
 * @param principal - The authenticated principal making the request
 * @param groupStore - The current group/org/sharing-policy store
 * @param authToken - Bearer token to forward to peer instances (the user's own token)
 * @param localResults - Results already gathered from local workspaces
 * @param fetchFn - Optional fetch override (for testing)
 */
export async function performCrossOrgSearch(
  q: string,
  principal: Principal,
  groupStore: GroupStore,
  authToken: string | undefined,
  localResults: SearchResult[],
  fetchFn: typeof fetch = fetch,
): Promise<CrossOrgSearchResult> {
  // Resolve the user's org from their Entra tenantId
  const userOrg = principal.tenantId ? resolveOrgForUser(principal.tenantId, groupStore) : undefined;

  if (!userOrg) {
    // User doesn't belong to any registered org — return local results only
    return {
      results: localResults,
      sources: { local: localResults.length, peers: {} },
    };
  }

  // Find all orgs in the same group where this user's org has read or bidirectional access
  const groupOrgs = findOrgsByGroup(groupStore, userOrg.groupId);
  const permitted = groupOrgs.filter(
    o => o.id !== userOrg.id && canSearchCrossOrg(groupStore, userOrg.id, o.id),
  );

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const peerCounts: Record<string, number> = {};
  const peerResults: SearchResult[] = [];

  for (const targetOrg of permitted) {
    if (!targetOrg.peerUrl) {
      console.log(`[cross-org] Org "${targetOrg.name}" (${targetOrg.id}) has no peerUrl — skipping`);
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const peerUrl = `${targetOrg.peerUrl}/search?q=${encodeURIComponent(q)}&all-workspaces=true&min-tier=institutional`;

      let response: Response;
      try {
        response = await fetchFn(peerUrl, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        console.warn(`[cross-org] Peer "${targetOrg.name}" returned ${response.status} — skipping`);
        continue;
      }

      const data = (await response.json()) as { results?: unknown[] } | unknown[];
      const items: unknown[] = Array.isArray(data)
        ? data
        : ((data as { results?: unknown[] }).results ?? []);

      const annotated = items.map(r => ({
        ...(r as object),
        source: 'peer',
        orgName: targetOrg.name,
        orgId: targetOrg.id,
      }));

      peerResults.push(...annotated);
      peerCounts[targetOrg.name] = annotated.length;
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'AbortError') {
        console.warn(`[cross-org] Peer "${targetOrg.name}" timed out after 3s — skipping`);
      } else {
        console.warn(
          `[cross-org] Failed to fetch from peer "${targetOrg.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Continue — a single peer failure must not affect other peers or local results
    }
  }

  // Merge local + peer results, deduplicating by chunk id
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const r of localResults) {
    const id = (r as { id?: string }).id;
    if (id) seen.add(id);
    merged.push(r);
  }

  for (const r of peerResults) {
    const id = (r as { id?: string }).id;
    if (!id || !seen.has(id)) {
      if (id) seen.add(id);
      merged.push(r);
    }
  }

  return {
    results: merged,
    sources: { local: localResults.length, peers: peerCounts },
  };
}
