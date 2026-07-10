// NEXT_FEATURES #30: evidence-backed confidence scoring, built only on provenance signals #23
// already surfaces -- never a model's own self-reported confidence. Deliberately not an LLM
// feature: pure, deterministic, and available with `llm.enabled: false`. Decoupled from
// `commands/report.ts`'s `ReportItem` type on purpose (structurally compatible, not imported) so
// this stays a `context/`-layer primitive that `report.ts`/`review.ts` can both consume without
// depending on each other through it.
export type ConfidenceEvidenceItem = {
  repo: string;
  path: string;
  section: 'architecture' | 'recent' | 'memory' | 'memory-hit';
  sourceFile?: string;
  timestamp?: string;
  lastIndexed?: string;
  stale?: boolean;
};

export type ConfidenceFactors = {
  // 0-1 weight for how authoritative this kind of source is on its own.
  sourceTypeWeight: number;
  // 0-1, decaying with age; 0.5 ("unknown, treat as neutral") when no timestamp is available.
  recencyScore: number;
  // Whether this item's claim still agrees with the current repo/source state -- for
  // architecture/recent items this is literally "not stale" (see freshness.ts); for a memory-hit
  // it's whether its named source file still resolves to a real, current item.
  docCodeAgreement: 'agrees' | 'disagrees' | 'unknown';
  // How many OTHER items, from a different repo or a different section, independently reference
  // the same path/source file -- the strongest single signal, since it means more than one source
  // says the same thing.
  corroboratingSources: number;
};

export type ConfidenceResult = { score: number; factors: ConfidenceFactors };

const SOURCE_TYPE_WEIGHT: Record<ConfidenceEvidenceItem['section'], number> = {
  recent: 1,
  architecture: 0.85,
  'memory-hit': 0.6,
  memory: 0.4
};

const RECENCY_FULL_WEIGHT_DAYS = 7;
const RECENCY_FLOOR_DAYS = 365;
const RECENCY_FLOOR_SCORE = 0.1;

export function computeConfidence(item: ConfidenceEvidenceItem, allItems: ConfidenceEvidenceItem[], now = new Date()): ConfidenceResult {
  const sourceTypeWeight = SOURCE_TYPE_WEIGHT[item.section];
  const recencyScore = computeRecencyScore(item.timestamp ?? item.lastIndexed, now);
  const docCodeAgreement = computeDocCodeAgreement(item, allItems);
  const corroboratingSources = countCorroboratingSources(item, allItems);

  const agreementScore = docCodeAgreement === 'agrees' ? 1 : docCodeAgreement === 'unknown' ? 0.5 : 0;
  const corroborationScore = Math.min(corroboratingSources, 4) / 4;

  const score = sourceTypeWeight * 0.3 + recencyScore * 0.3 + agreementScore * 0.2 + corroborationScore * 0.2;

  return {
    score: Math.round(clamp(score, 0, 1) * 100) / 100,
    factors: { sourceTypeWeight, recencyScore, docCodeAgreement, corroboratingSources }
  };
}

function computeRecencyScore(dateString: string | undefined, now: Date): number {
  if (!dateString) return 0.5;
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return 0.5;

  const ageDays = (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= RECENCY_FULL_WEIGHT_DAYS) return 1;
  if (ageDays >= RECENCY_FLOOR_DAYS) return RECENCY_FLOOR_SCORE;

  const progress = (ageDays - RECENCY_FULL_WEIGHT_DAYS) / (RECENCY_FLOOR_DAYS - RECENCY_FULL_WEIGHT_DAYS);
  return 1 - progress * (1 - RECENCY_FLOOR_SCORE);
}

function computeDocCodeAgreement(item: ConfidenceEvidenceItem, allItems: ConfidenceEvidenceItem[]): ConfidenceFactors['docCodeAgreement'] {
  if (item.section === 'architecture' || item.section === 'recent') {
    return item.stale ? 'disagrees' : 'agrees';
  }

  if (item.section === 'memory-hit') {
    if (!item.sourceFile) return 'unknown';
    const matched = resolveSourceFile(item, allItems);
    if (!matched) return 'unknown';
    return matched.stale ? 'disagrees' : 'agrees';
  }

  // A "memory" item is just a wing/room aggregate count, not a claim about a specific file.
  return 'unknown';
}

function resolveSourceFile(item: ConfidenceEvidenceItem, allItems: ConfidenceEvidenceItem[]): ConfidenceEvidenceItem | undefined {
  const candidates = allItems.filter(candidate => candidate.section === 'architecture' || candidate.section === 'recent');
  return (
    candidates.find(candidate => candidate.repo === item.repo && candidate.path === item.sourceFile) ??
    candidates.find(candidate => candidate.path === item.sourceFile)
  );
}

function countCorroboratingSources(item: ConfidenceEvidenceItem, allItems: ConfidenceEvidenceItem[]): number {
  const key = item.section === 'memory-hit' ? item.sourceFile : item.path;
  if (!key) return 0;

  const seen = new Set<string>();
  for (const candidate of allItems) {
    if (candidate === item) continue;
    const candidateKey = candidate.section === 'memory-hit' ? candidate.sourceFile : candidate.path;
    if (candidateKey !== key) continue;
    // Only count independent sources: a different repo, or the same repo but a different section
    // (e.g. a memory-hit and the actual source file agreeing counts; two memory-hits in the same
    // wing/room repeating the same text does not).
    if (candidate.repo === item.repo && candidate.section === item.section) continue;
    seen.add(`${candidate.repo}:${candidate.section}`);
  }
  return seen.size;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
