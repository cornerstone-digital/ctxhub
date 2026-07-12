/**
 * ADR-020 / docs/evidence_sources_architecture.md: an EvidenceSource adapter reads a
 * source's own structure and yields raw, untrusted Evidence. It never produces Knowledge
 * Objects directly -- indexWorkspace's existing chunk/redact/trust-tier pipeline is what
 * turns Evidence into indexed, reviewable material, and promotion (ADR-008) is what turns
 * reviewed material into trusted Knowledge.
 */
export type Evidence = {
  /** Adapter-specific stable id: a file path, a transaction id, a page id, etc. */
  sourceId: string;
  /** Normalised text content, fed into the existing chunk/redact pipeline unchanged. */
  content: string;
  metadata: Record<string, unknown>;
  /**
   * Set when the adapter found this item but couldn't read it (e.g. a file over the size
   * limit, a fetch failure for one record). indexer.ts skips it without hashing/chunking,
   * but still marks its manifest key as seen so stale-entry cleanup doesn't delete a
   * previously-indexed item just because it became unreadable on this run.
   */
  unreadable?: string;
};

export interface EvidenceSource {
  /** Adapter kind, e.g. 'git', 'land-registry'. */
  kind: string;
  /** The configured source's display/manifest name. */
  name: string;
  /** Cheap reachability/existence check. */
  detect(): Promise<boolean>;
  /**
   * `total` must be known before any item streams -- indexer.ts reports it immediately so
   * progress has an accurate denominator from the start, the same guarantee git indexing
   * has always made. Every adapter already knows its candidate count cheaply before reading
   * content (a file listing, a parsed-and-filtered row set), so this isn't a git-only ask.
   */
  fetch(): Promise<{ total: number; items: AsyncIterable<Evidence> }>;
}
