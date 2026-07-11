import type { KnowledgeObject } from './types.js';

export interface VelocityBucket {
  date: string;        // ISO date (YYYY-MM-DD)
  created: number;
  promoted: number;    // draft→active transitions (proxy)
  archived: number;
  superseded: number;
}

export interface VelocityReport {
  workspaceId: string;
  period: { from: string; to: string };
  buckets: VelocityBucket[];
  totals: { created: number; promoted: number; archived: number; superseded: number };
  trend: 'growing' | 'stable' | 'declining';
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function bucketKey(date: Date, bucketSize: 'day' | 'week'): string {
  if (bucketSize === 'day') return toDateStr(date);
  return toDateStr(startOfWeek(date));
}

/**
 * Build an ordered list of bucket keys (YYYY-MM-DD) covering from..to.
 */
function buildBucketKeys(from: Date, to: Date, bucketSize: 'day' | 'week'): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor <= to) {
    const key = bucketKey(cursor, bucketSize);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor.setUTCDate(cursor.getUTCDate() + (bucketSize === 'week' ? 7 : 1));
  }

  return keys;
}

export function computeVelocity(
  objects: KnowledgeObject[],
  from: Date,
  to: Date,
  bucketSize: 'day' | 'week',
  workspaceId = '',
): VelocityReport {
  const bucketMap = new Map<string, VelocityBucket>();

  // Pre-populate all buckets in range (including empty ones)
  for (const key of buildBucketKeys(from, to, bucketSize)) {
    bucketMap.set(key, { date: key, created: 0, promoted: 0, archived: 0, superseded: 0 });
  }

  for (const ko of objects) {
    const createdDate = new Date(ko.createdAt);
    if (createdDate < from || createdDate > to) continue;

    const key = bucketKey(createdDate, bucketSize);
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    bucket.created++;

    // Proxy for promotion: state is active and updatedAt differs from createdAt
    if (ko.state === 'active' && ko.updatedAt !== ko.createdAt) {
      bucket.promoted++;
    }

    if (ko.state === 'archived') bucket.archived++;
    if (ko.state === 'superseded') bucket.superseded++;
  }

  const buckets = [...bucketMap.values()];

  const totals = buckets.reduce(
    (acc, b) => ({
      created: acc.created + b.created,
      promoted: acc.promoted + b.promoted,
      archived: acc.archived + b.archived,
      superseded: acc.superseded + b.superseded,
    }),
    { created: 0, promoted: 0, archived: 0, superseded: 0 },
  );

  // Trend: compare second half vs first half by 'created' count
  const midIndex = Math.floor(buckets.length / 2);
  const firstHalf = buckets.slice(0, midIndex).reduce((s, b) => s + b.created, 0);
  const secondHalf = buckets.slice(midIndex).reduce((s, b) => s + b.created, 0);

  let trend: VelocityReport['trend'];
  if (secondHalf > firstHalf) trend = 'growing';
  else if (secondHalf < firstHalf) trend = 'declining';
  else trend = 'stable';

  return {
    workspaceId,
    period: { from: toDateStr(from), to: toDateStr(to) },
    buckets,
    totals,
    trend,
  };
}
