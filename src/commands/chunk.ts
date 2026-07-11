import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { meetsMinTrustTier, TRUST_TIER_ORDER, type ChunkTrustTier } from '../indexing/chunk.js';
import type { IndexedDocument } from '../config/types.js';

const PROMOTABLE_TIERS: ChunkTrustTier[] = ['institutional', 'canonical'];

// ── chunkPromoteCommand ───────────────────────────────────────────────────────

export async function chunkPromoteCommand(
  chunkId: string,
  opts: { tier: string; reason?: string; by?: string } = { tier: '' }
) {
  const tier = opts.tier as ChunkTrustTier;
  if (!PROMOTABLE_TIERS.includes(tier)) {
    console.error(chalk.red(`Invalid tier "${opts.tier}". Must be one of: ${PROMOTABLE_TIERS.join(', ')}`));
    process.exit(1);
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);

  const chunk = await resolveChunk(chunkId, index);
  if (!chunk) {
    console.error(chalk.red(`Chunk not found: ${chunkId}`));
    process.exit(1);
  }

  const updated: IndexedDocument = {
    ...chunk,
    trustTier: tier,
    promotedAt: new Date().toISOString(),
    promotedBy: opts.by ?? 'cli',
    ...(opts.reason ? { promotionReason: opts.reason } : {})
  };

  await index.indexDocuments([updated]);

  console.log(chalk.green(`✓ Chunk ${chunk.id.slice(0, 12)} promoted to ${tier}`));
  console.log(chalk.gray(`  File: ${chunk.repo}:${chunk.filePath}`));
  if (chunk.title) console.log(chalk.gray(`  Title: ${chunk.title}`));
  if (opts.reason) console.log(chalk.gray(`  Reason: ${opts.reason}`));
}

// ── chunkListCommand ──────────────────────────────────────────────────────────

export async function chunkListCommand(opts: { minTier?: string } = {}) {
  const minTier = (opts.minTier ?? 'unverified') as ChunkTrustTier;
  if (!TRUST_TIER_ORDER.includes(minTier)) {
    console.error(chalk.red(`Invalid tier "${opts.minTier}". Must be one of: ${TRUST_TIER_ORDER.join(', ')}`));
    process.exit(1);
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);

  // Fetch a generous limit — chunk list is a diagnostic/admin command, not real-time search.
  const all = await index.recent(10_000);
  const matching = all.filter(chunk => meetsMinTrustTier(chunk, minTier));

  if (!matching.length) {
    console.log(chalk.yellow(`No chunks found at tier ${minTier} or above.`));
    return;
  }

  const tierColor = (tier: string | undefined): string => {
    switch (tier) {
      case 'canonical': return chalk.magenta(tier);
      case 'institutional': return chalk.blue(tier);
      case 'promoted': return chalk.cyan(tier);
      case 'reviewed': return chalk.green(tier);
      default: return chalk.gray(tier ?? 'unverified');
    }
  };

  console.log(chalk.bold(`${matching.length} chunk(s) at tier >= ${minTier}:\n`));
  for (const chunk of matching) {
    const label = chunk.title ?? `${chunk.filePath}`;
    console.log(`  ${chalk.dim(chunk.id.slice(0, 12))}  ${tierColor(chunk.trustTier)}  ${chunk.repo}:${label}`);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

type MinimalIndex = {
  getDocument(id: string): Promise<IndexedDocument | undefined>;
  recent(limit?: number): Promise<IndexedDocument[]>;
};

async function resolveChunk(id: string, index: MinimalIndex): Promise<IndexedDocument | undefined> {
  const exact = await index.getDocument(id);
  if (exact) return exact;

  if (id.length < 8) return undefined;
  const matches = (await index.recent(10_000)).filter(c => c.id.startsWith(id));
  if (matches.length > 1) {
    throw new Error(`Chunk id prefix is ambiguous: "${id}". Matches: ${matches.map(m => m.id.slice(0, 12)).join(', ')}`);
  }
  return matches[0];
}
