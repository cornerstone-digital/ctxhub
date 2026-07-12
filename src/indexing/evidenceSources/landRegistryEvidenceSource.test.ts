import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LandRegistryEvidenceSource } from './landRegistryEvidenceSource.js';

// Rows shaped exactly like the real HM Land Registry Price Paid monthly CSV: no header,
// fixed column order (id, price, date, postcode, type, new, duration, paon, saon, street,
// locality, town, district, county, category, record status). Confirmed against a live
// byte-range fetch of the real file while building this adapter.
const SAMPLE_ROWS = [
  '"{TXN-1}","360000","2025-06-29 00:00","SW1A 1AA","F","N","L","81","","SALISBURY ROAD","","LONDON","WESTMINSTER","GREATER LONDON","A","A"',
  '"{TXN-2}","362500","2024-01-28 00:00","SW1A 2BB","F","Y","L","BYRON COURT","FLAT 15","ST JOHNS ROAD","","LONDON","WESTMINSTER","GREATER LONDON","A","A"',
  // Different postcode area -- must be filtered out.
  '"{TXN-3}","545995","2025-08-27 00:00","RM12 6DY","D","Y","F","3","","GAUNTLET DRIVE","","HORNCHURCH","HAVERING","GREATER LONDON","A","A"',
  // Same outcode but a withdrawn/deleted record -- must be filtered out.
  '"{TXN-4}","500000","2025-05-17 00:00","SW1A 3CC","S","N","F","29","","COURT CRESCENT","","LONDON","WESTMINSTER","GREATER LONDON","A","D"',
  // Same outcode, but old enough to fall outside the default 12-month window.
  '"{TXN-5}","200000","2018-01-11 00:00","SW1A 4DD","T","N","F","5","","OLD ROAD","","LONDON","WESTMINSTER","GREATER LONDON","A","A"'
].join('\n');

function fakeFetch(csvText: string, status = 200): typeof globalThis.fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'HEAD') {
      return { ok: status === 200, status } as Response;
    }
    return {
      ok: status === 200,
      status,
      text: async () => csvText
    } as Response;
  }) as typeof globalThis.fetch;
}

let originalFetch: typeof globalThis.fetch;

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

test('fetch filters to the configured postcode area, drops deleted records and stale dates, and reports an accurate total', async () => {
  globalThis.fetch = fakeFetch(SAMPLE_ROWS);
  const source = new LandRegistryEvidenceSource({ kind: 'land-registry', name: 'sw1a-sales', postcodeArea: 'SW1A', sinceDate: '2020-01-01' });

  const { total, items } = await source.fetch();
  const evidence = [];
  for await (const item of items) evidence.push(item);

  assert.equal(total, 2);
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map(e => e.sourceId).sort(), ['{TXN-1}', '{TXN-2}']);
});

test('evidence content is a readable summary and metadata carries the structured fields', async () => {
  globalThis.fetch = fakeFetch(SAMPLE_ROWS);
  const source = new LandRegistryEvidenceSource({ kind: 'land-registry', name: 'sw1a-sales', postcodeArea: 'SW1A', sinceDate: '2020-01-01' });

  const { items } = await source.fetch();
  const collected = [];
  for await (const item of items) collected.push(item);
  const txn1 = collected.find(e => e.sourceId === '{TXN-1}')!;

  assert.match(txn1.content, /£360,000/);
  assert.match(txn1.content, /SW1A 1AA/);
  assert.match(txn1.content, /flat\/maisonette/);
  assert.match(txn1.content, /leasehold/);
  assert.equal(txn1.metadata.price, 360000);
  assert.equal(txn1.metadata.postcode, 'SW1A 1AA');
  assert.equal(txn1.metadata.newBuild, false);
});

test('respects the default 12-month window when sinceDate is not configured', async () => {
  const isoDate = (monthsAgo: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo);
    return d.toISOString().slice(0, 10);
  };
  const rows = [
    `"{RECENT}","300000","${isoDate(6)} 00:00","SW1A 5EE","F","N","L","1","","A ROAD","","LONDON","WESTMINSTER","GREATER LONDON","A","A"`,
    `"{OLD}","300000","${isoDate(18)} 00:00","SW1A 5EE","F","N","L","2","","A ROAD","","LONDON","WESTMINSTER","GREATER LONDON","A","A"`
  ].join('\n');
  globalThis.fetch = fakeFetch(rows);
  const source = new LandRegistryEvidenceSource({ kind: 'land-registry', name: 'sw1a-sales', postcodeArea: 'SW1A' });

  const { total, items } = await source.fetch();
  const collected = [];
  for await (const item of items) collected.push(item);

  assert.equal(total, 1);
  assert.deepEqual(collected.map(e => e.sourceId), ['{RECENT}']);
});

test('detect() reflects HEAD request reachability', async () => {
  globalThis.fetch = fakeFetch(SAMPLE_ROWS, 200);
  const reachable = new LandRegistryEvidenceSource({ kind: 'land-registry', name: 'x', postcodeArea: 'SW1A' });
  assert.equal(await reachable.detect(), true);

  globalThis.fetch = fakeFetch(SAMPLE_ROWS, 503);
  const unreachable = new LandRegistryEvidenceSource({ kind: 'land-registry', name: 'x', postcodeArea: 'SW1A' });
  assert.equal(await unreachable.detect(), false);
});

test('a failed GET degrades to zero results instead of throwing', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof globalThis.fetch;

  const source = new LandRegistryEvidenceSource({ kind: 'land-registry', name: 'x', postcodeArea: 'SW1A' });
  const { total, items } = await source.fetch();
  const collected = [];
  for await (const item of items) collected.push(item);

  assert.equal(total, 0);
  assert.deepEqual(collected, []);
});
