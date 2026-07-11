import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVelocity } from './velocity.js';
import type { KnowledgeObject } from './types.js';

function makeKo(
  id: string,
  createdAt: string,
  updatedAt: string,
  state: KnowledgeObject['state'] = 'active',
): KnowledgeObject {
  return {
    id,
    workspaceId: 'test-ws',
    title: `Object ${id}`,
    content: 'content',
    state,
    confidence: 0.8,
    corroborations: [],
    createdAt,
    updatedAt,
    createdBy: 'test',
  };
}

const from = new Date('2025-01-01');
const to = new Date('2025-01-07');

test('computeVelocity with empty objects returns all-zero report', () => {
  const report = computeVelocity([], from, to, 'day', 'ws1');
  assert.equal(report.totals.created, 0);
  assert.equal(report.totals.promoted, 0);
  assert.equal(report.totals.archived, 0);
  assert.equal(report.totals.superseded, 0);
  assert.ok(report.buckets.length > 0); // still has bucket skeleton
});

test('computeVelocity counts created correctly by day', () => {
  const objects = [
    makeKo('a', '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z', 'draft'),
    makeKo('b', '2025-01-01T12:00:00.000Z', '2025-01-02T10:00:00.000Z', 'active'),
    makeKo('c', '2025-01-03T08:00:00.000Z', '2025-01-03T08:00:00.000Z', 'archived'),
    makeKo('d', '2025-01-05T09:00:00.000Z', '2025-01-05T09:00:00.000Z', 'superseded'),
  ];

  const report = computeVelocity(objects, from, to, 'day', 'ws1');
  assert.equal(report.totals.created, 4);

  const jan1 = report.buckets.find(b => b.date === '2025-01-01');
  assert.ok(jan1);
  assert.equal(jan1.created, 2); // two objects on Jan 1

  const jan3 = report.buckets.find(b => b.date === '2025-01-03');
  assert.ok(jan3);
  assert.equal(jan3.created, 1);
  assert.equal(jan3.archived, 1);

  const jan5 = report.buckets.find(b => b.date === '2025-01-05');
  assert.ok(jan5);
  assert.equal(jan5.superseded, 1);
});

test('computeVelocity excludes objects outside date range', () => {
  const objects = [
    makeKo('a', '2024-12-31T23:59:00.000Z', '2025-01-01T00:00:00.000Z', 'active'), // before
    makeKo('b', '2025-01-08T00:01:00.000Z', '2025-01-08T00:01:00.000Z', 'active'), // after
    makeKo('c', '2025-01-04T00:00:00.000Z', '2025-01-04T00:00:00.000Z', 'active'), // inside
  ];

  const report = computeVelocity(objects, from, to, 'day', 'ws1');
  assert.equal(report.totals.created, 1);
});

test('computeVelocity trend growing when recent half > prior half', () => {
  const from2 = new Date('2025-01-01');
  const to2 = new Date('2025-01-14');

  // More objects in second half (Jan 8-14)
  const objects = [
    makeKo('a', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
    makeKo('b', '2025-01-09T00:00:00.000Z', '2025-01-09T00:00:00.000Z'),
    makeKo('c', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z'),
    makeKo('d', '2025-01-11T00:00:00.000Z', '2025-01-11T00:00:00.000Z'),
  ];

  const report = computeVelocity(objects, from2, to2, 'day', 'ws1');
  assert.equal(report.trend, 'growing');
});

test('computeVelocity trend declining when recent half < prior half', () => {
  const from2 = new Date('2025-01-01');
  const to2 = new Date('2025-01-14');

  // More objects in first half (Jan 1-7)
  const objects = [
    makeKo('a', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
    makeKo('b', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z'),
    makeKo('c', '2025-01-03T00:00:00.000Z', '2025-01-03T00:00:00.000Z'),
    makeKo('d', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z'),
  ];

  const report = computeVelocity(objects, from2, to2, 'day', 'ws1');
  assert.equal(report.trend, 'declining');
});

test('computeVelocity trend stable when halves are equal', () => {
  const from2 = new Date('2025-01-01');
  const to2 = new Date('2025-01-14');

  const objects = [
    makeKo('a', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
    makeKo('b', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z'),
  ];

  const report = computeVelocity(objects, from2, to2, 'day', 'ws1');
  assert.equal(report.trend, 'stable');
});

test('computeVelocity counts promoted (active with different updatedAt)', () => {
  const objects = [
    // promoted: state=active, updatedAt != createdAt
    makeKo('a', '2025-01-02T00:00:00.000Z', '2025-01-03T00:00:00.000Z', 'active'),
    // not promoted: state=draft
    makeKo('b', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z', 'draft'),
  ];

  const report = computeVelocity(objects, from, to, 'day', 'ws1');
  assert.equal(report.totals.promoted, 1);
  assert.equal(report.totals.created, 2);
});

test('computeVelocity report includes correct period', () => {
  const report = computeVelocity([], from, to, 'day', 'my-workspace');
  assert.equal(report.period.from, '2025-01-01');
  assert.equal(report.period.to, '2025-01-07');
  assert.equal(report.workspaceId, 'my-workspace');
});
