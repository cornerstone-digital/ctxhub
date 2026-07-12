import { parse } from 'csv-parse/sync';
import type { LandRegistryEvidenceSourceConfig } from '../../config/types.js';
import type { Evidence, EvidenceSource } from '../evidenceSource.js';

// HM Land Registry Price Paid Data, Open Government Licence v3.0, no auth required.
// Monthly update file (not the ~4GB complete file) -- covers roughly the last 12 months
// of transactions, which is what a "recent comparable sales" adapter actually needs.
// Verified live and its column layout confirmed against a real byte-range fetch while
// building this adapter (docs/evidence_sources_architecture.md).
const MONTHLY_CSV_URL = 'https://price-paid-data.publicdata.landregistry.gov.uk/pp-monthly-update-new-version.csv';
const FETCH_TIMEOUT_MS = 30_000;

// Official PPD column order (the file ships with no header row):
// 0 id, 1 price, 2 date of transfer, 3 postcode, 4 property type, 5 old/new,
// 6 duration, 7 PAON, 8 SAON, 9 street, 10 locality, 11 town/city, 12 district,
// 13 county, 14 PPD category type, 15 record status (A=addition, C=change, D=delete).
const PROPERTY_TYPE_LABELS: Record<string, string> = {
  D: 'detached',
  S: 'semi-detached',
  T: 'terraced',
  F: 'flat/maisonette',
  O: 'other'
};
const DURATION_LABELS: Record<string, string> = { F: 'freehold', L: 'leasehold' };

function defaultSinceDate(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d;
}

function toEvidence(row: string[]): Evidence | null {
  const [transactionId, priceRaw, dateRaw, postcode, propertyType, isNew, duration, paon, saon, street, locality, town, district, county] = row;
  if (!transactionId || !priceRaw || !postcode) return null;

  const price = Number(priceRaw);
  const date = dateRaw?.split(' ')[0] ?? dateRaw;
  const address = [saon, paon, street, locality, town, district, county].filter(Boolean).join(', ');
  const propertyLabel = PROPERTY_TYPE_LABELS[propertyType] ?? propertyType;
  const durationLabel = DURATION_LABELS[duration] ?? duration;

  const content = `£${Number.isFinite(price) ? price.toLocaleString('en-GB') : priceRaw} paid for ${address} (${postcode}) on ${date}. ${propertyLabel}${isNew === 'Y' ? ', new build' : ''}, ${durationLabel}.`;

  return {
    sourceId: transactionId,
    content,
    metadata: { price, date, postcode, propertyType, duration, newBuild: isNew === 'Y', address }
  };
}

/**
 * ADR-020's second real EvidenceSource adapter: UK Land Registry Price Paid Data,
 * filtered to a configured postcode outcode. Each transaction becomes one Evidence item --
 * raw, untrusted comparable-sale material, same as any other source. Nothing here creates
 * a Knowledge Object directly; that still goes through indexWorkspace's existing chunk/
 * trust-tier pipeline and, eventually, promotion (ADR-008).
 */
export class LandRegistryEvidenceSource implements EvidenceSource {
  readonly kind = 'land-registry';
  readonly name: string;

  constructor(private readonly config: LandRegistryEvidenceSourceConfig) {
    this.name = config.name;
  }

  async detect(): Promise<boolean> {
    try {
      const res = await fetch(MONTHLY_CSV_URL, { method: 'HEAD', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<{ total: number; items: AsyncIterable<Evidence> }> {
    const outcode = this.config.postcodeArea.trim().toUpperCase();
    const sinceDate = this.config.sinceDate ? new Date(this.config.sinceDate) : defaultSinceDate();

    let res: Response;
    try {
      res = await fetch(MONTHLY_CSV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      console.warn(`[land-registry:${this.name}] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return { total: 0, items: emptyItems() };
    }
    if (!res.ok) {
      console.warn(`[land-registry:${this.name}] fetch failed: HTTP ${res.status}`);
      return { total: 0, items: emptyItems() };
    }

    const csvText = await res.text();
    const rows = parse(csvText, { columns: false, skip_empty_lines: true }) as string[][];

    const matched = rows.filter(row => {
      const postcode = row[3];
      const recordStatus = row[15];
      if (!postcode || recordStatus === 'D') return false;
      if (!postcode.toUpperCase().startsWith(outcode)) return false;
      const dateStr = row[2]?.split(' ')[0];
      return !(dateStr && new Date(dateStr) < sinceDate);
    });

    return { total: matched.length, items: yieldRows(matched) };
  }
}

async function* yieldRows(rows: string[][]): AsyncIterable<Evidence> {
  for (const row of rows) {
    const evidence = toEvidence(row);
    if (evidence) yield evidence;
  }
}

async function* emptyItems(): AsyncIterable<Evidence> {}
