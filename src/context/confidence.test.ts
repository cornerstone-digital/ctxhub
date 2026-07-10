import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeConfidence, type ConfidenceEvidenceItem } from './confidence.js';

const NOW = new Date('2026-07-10T00:00:00.000Z');

test('computeConfidence scores a fresh, non-stale, uncorroborated source-code item using only sourceType/recency weight', () => {
  const item: ConfidenceEvidenceItem = { repo: 'app', path: 'src/auth.ts', section: 'recent', lastIndexed: '2026-07-08T00:00:00.000Z', stale: false };
  const result = computeConfidence(item, [item], NOW);

  assert.equal(result.factors.sourceTypeWeight, 1);
  assert.equal(result.factors.recencyScore, 1);
  assert.equal(result.factors.docCodeAgreement, 'agrees');
  assert.equal(result.factors.corroboratingSources, 0);
  // 1*0.3 + 1*0.3 + 1*0.2 + 0*0.2 = 0.8
  assert.equal(result.score, 0.8);
});

test('computeConfidence penalizes a stale recent/architecture item via docCodeAgreement', () => {
  const item: ConfidenceEvidenceItem = { repo: 'app', path: 'src/auth.ts', section: 'recent', lastIndexed: '2026-07-08T00:00:00.000Z', stale: true };
  const result = computeConfidence(item, [item], NOW);

  assert.equal(result.factors.docCodeAgreement, 'disagrees');
  assert.equal(result.score, 0.6); // 1*0.3 + 1*0.3 + 0*0.2 + 0*0.2
});

test('computeConfidence treats a missing timestamp as neutral recency, not a penalty or a bonus', () => {
  const item: ConfidenceEvidenceItem = { repo: 'app', path: 'src/auth.ts', section: 'recent', stale: false };
  const result = computeConfidence(item, [item], NOW);
  assert.equal(result.factors.recencyScore, 0.5);
});

test('computeConfidence decays recency between the full-weight window and the floor, then holds at the floor', () => {
  const recent: ConfidenceEvidenceItem = { repo: 'app', path: 'a', section: 'recent', lastIndexed: '2026-07-05T00:00:00.000Z' }; // 5 days old
  const midAge: ConfidenceEvidenceItem = { repo: 'app', path: 'b', section: 'recent', lastIndexed: '2026-01-10T00:00:00.000Z' }; // ~181 days old
  const veryOld: ConfidenceEvidenceItem = { repo: 'app', path: 'c', section: 'recent', lastIndexed: '2020-01-01T00:00:00.000Z' };

  const recentScore = computeConfidence(recent, [recent], NOW).factors.recencyScore;
  const midScore = computeConfidence(midAge, [midAge], NOW).factors.recencyScore;
  const oldScore = computeConfidence(veryOld, [veryOld], NOW).factors.recencyScore;

  assert.equal(recentScore, 1);
  assert.ok(midScore > 0.1 && midScore < 1, `expected a mid-range decayed score, got ${midScore}`);
  assert.equal(oldScore, 0.1);
});

test('computeConfidence counts corroboration only from independent sources (different repo, or different section within the same repo)', () => {
  const sourceFile: ConfidenceEvidenceItem = { repo: 'app', path: 'auth.ts', section: 'recent', lastIndexed: '2026-07-01T00:00:00.000Z' };
  const architectureDoc: ConfidenceEvidenceItem = { repo: 'app', path: 'auth.ts', section: 'architecture', lastIndexed: '2026-07-01T00:00:00.000Z' };
  const memoryHit: ConfidenceEvidenceItem = { repo: 'app', path: 'decisions', section: 'memory-hit', sourceFile: 'auth.ts', timestamp: '2026-07-01T00:00:00.000Z' };
  const duplicateHitSameWing: ConfidenceEvidenceItem = { repo: 'app', path: 'decisions', section: 'memory-hit', sourceFile: 'auth.ts', timestamp: '2026-07-01T00:00:00.000Z' };
  const allItems = [sourceFile, architectureDoc, memoryHit, duplicateHitSameWing];

  const result = computeConfidence(memoryHit, allItems, NOW);
  // sourceFile (recent) and architectureDoc both independently corroborate; the duplicate hit in
  // the same repo+section does not count again.
  assert.equal(result.factors.corroboratingSources, 2);
  assert.equal(result.factors.docCodeAgreement, 'agrees');
});

test('computeConfidence marks a memory-hit "unknown" agreement when it names no source file, and reports zero corroboration', () => {
  const item: ConfidenceEvidenceItem = { repo: 'app', path: 'decisions', section: 'memory-hit', timestamp: '2026-07-01T00:00:00.000Z' };
  const result = computeConfidence(item, [item], NOW);
  assert.equal(result.factors.docCodeAgreement, 'unknown');
  assert.equal(result.factors.corroboratingSources, 0);
});

test('computeConfidence marks a memory-hit "unknown" (not "disagrees") when its named source file no longer resolves to anything', () => {
  const item: ConfidenceEvidenceItem = { repo: 'app', path: 'decisions', section: 'memory-hit', sourceFile: 'deleted-file.ts', timestamp: '2026-07-01T00:00:00.000Z' };
  const result = computeConfidence(item, [item], NOW);
  assert.equal(result.factors.docCodeAgreement, 'unknown');
});

test('computeConfidence marks a memory-hit "disagrees" when its resolved source file is itself stale/drifted', () => {
  const staleSource: ConfidenceEvidenceItem = { repo: 'app', path: 'auth.ts', section: 'recent', stale: true };
  const memoryHit: ConfidenceEvidenceItem = { repo: 'app', path: 'decisions', section: 'memory-hit', sourceFile: 'auth.ts', timestamp: '2026-07-01T00:00:00.000Z' };
  const result = computeConfidence(memoryHit, [staleSource, memoryHit], NOW);
  assert.equal(result.factors.docCodeAgreement, 'disagrees');
});

test('computeConfidence treats a bare "memory" wing/room summary item as unknown agreement, since it is an aggregate count, not a specific claim', () => {
  const item: ConfidenceEvidenceItem = { repo: 'app', path: 'decisions', section: 'memory' };
  const result = computeConfidence(item, [item], NOW);
  assert.equal(result.factors.sourceTypeWeight, 0.4);
  assert.equal(result.factors.docCodeAgreement, 'unknown');
});

test('computeConfidence caps the corroboration bonus rather than growing unbounded', () => {
  const base: ConfidenceEvidenceItem = { repo: 'r0', path: 'shared.ts', section: 'recent' };
  const corroborators: ConfidenceEvidenceItem[] = Array.from({ length: 10 }, (_, i) => ({ repo: `r${i + 1}`, path: 'shared.ts', section: 'recent' as const }));
  const result = computeConfidence(base, [base, ...corroborators], NOW);

  assert.equal(result.factors.corroboratingSources, 10);
  // Score must still be a valid, clamped 0-1 value despite 10 corroborators far exceeding the cap.
  assert.ok(result.score <= 1);
});

test('computeConfidence produces a score in [0, 1] for every section, even worst-case inputs', () => {
  const sections: ConfidenceEvidenceItem['section'][] = ['recent', 'architecture', 'memory', 'memory-hit'];
  for (const section of sections) {
    const item: ConfidenceEvidenceItem = { repo: 'app', path: 'x', section, stale: true };
    const result = computeConfidence(item, [item], NOW);
    assert.ok(result.score >= 0 && result.score <= 1, `${section} produced out-of-range score ${result.score}`);
  }
});
