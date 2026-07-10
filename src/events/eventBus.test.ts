import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from './eventBus.js';

test('publish delivers the event to every current subscriber, enriched with id and timestamp', () => {
  const bus = new EventBus();
  const receivedA: unknown[] = [];
  const receivedB: unknown[] = [];
  bus.subscribe(event => receivedA.push(event));
  bus.subscribe(event => receivedB.push(event));

  const envelope = bus.publish({ type: 'index.started', workspace: 'demo' });

  assert.deepEqual(receivedA, [envelope]);
  assert.deepEqual(receivedB, [envelope]);
  assert.equal(envelope.type, 'index.started');
  assert.ok(envelope.id);
  assert.ok(envelope.at);
});

test('unsubscribe stops further delivery without affecting other subscribers', () => {
  const bus = new EventBus();
  const received: unknown[] = [];
  const unsubscribe = bus.subscribe(event => received.push(event));
  const stillListening: unknown[] = [];
  bus.subscribe(event => stillListening.push(event));

  bus.publish({ type: 'index.started', workspace: 'demo' });
  unsubscribe();
  bus.publish({ type: 'index.completed', workspace: 'demo', result: { scanned: 1, indexed: 1, skipped: 0, deleted: 0 } });

  assert.equal(received.length, 1);
  assert.equal(stillListening.length, 2);
});

test('each published event gets a unique, monotonically increasing id', () => {
  const bus = new EventBus();
  const first = bus.publish({ type: 'index.started', workspace: 'a' });
  const second = bus.publish({ type: 'index.started', workspace: 'b' });
  assert.notEqual(first.id, second.id);
});
