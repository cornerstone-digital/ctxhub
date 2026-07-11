/**
 * EF-3: Auth audit event shape tests.
 *
 * Tests verify that auth events are published with the correct shape using an
 * in-memory EventBus. No filesystem I/O is exercised here — we stub the
 * appendEventLog pathway by using a freshly-constructed EventBus (not the
 * singleton) so tests remain deterministic and never write to disk.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../events/eventBus.js';
import type { CtxhubEventEnvelope } from '../events/eventBus.js';

function captureEvents(bus: EventBus): CtxhubEventEnvelope[] {
  const captured: CtxhubEventEnvelope[] = [];
  bus.subscribe(e => captured.push(e));
  return captured;
}

describe('auth.login event shape', () => {
  it('publishes all required fields', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({
      type: 'auth.login',
      sub: 'aad-sub-123',
      email: 'alice@example.com',
      name: 'Alice Smith',
      roles: ['owner'],
      provider: 'entra',
    });

    assert.equal(events.length, 1);
    const ev = events[0];
    assert.equal(ev.type, 'auth.login');
    assert.ok('sub' in ev && ev.sub === 'aad-sub-123', 'sub should match');
    assert.ok('email' in ev && ev.email === 'alice@example.com', 'email should match');
    assert.ok('name' in ev && ev.name === 'Alice Smith', 'name should match');
    assert.ok('roles' in ev && Array.isArray(ev.roles), 'roles should be an array');
    assert.deepEqual((ev as typeof ev & { roles: string[] }).roles, ['owner']);
    assert.ok('provider' in ev && (ev as typeof ev & { provider: string }).provider === 'entra', 'provider should be entra');
  });

  it('envelope carries an id and ISO timestamp', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.login', sub: 's', email: 'e@x.com', name: 'E', roles: ['member'], provider: 'entra' });

    const ev = events[0];
    assert.ok(ev.id, 'id should be present');
    assert.ok(new Date(ev.at).getTime() > 0, 'at should be a valid ISO timestamp');
  });

  it('supports multiple roles', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.login', sub: 's', email: 'e@x.com', name: 'E', roles: ['admin', 'member'], provider: 'entra' });

    const ev = events[0] as typeof events[0] & { roles: string[] };
    assert.deepEqual(ev.roles, ['admin', 'member']);
  });
});

describe('auth.logout event shape', () => {
  it('publishes sub and email', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.logout', sub: 'aad-sub-456', email: 'bob@example.com' });

    assert.equal(events.length, 1);
    const ev = events[0] as typeof events[0] & { sub: string; email: string };
    assert.equal(ev.type, 'auth.logout');
    assert.equal(ev.sub, 'aad-sub-456');
    assert.equal(ev.email, 'bob@example.com');
  });
});

describe('auth.token_refresh event shape', () => {
  it('publishes sub and email', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.token_refresh', sub: 'aad-sub-789', email: 'carol@example.com' });

    assert.equal(events.length, 1);
    const ev = events[0] as typeof events[0] & { sub: string; email: string };
    assert.equal(ev.type, 'auth.token_refresh');
    assert.equal(ev.sub, 'aad-sub-789');
    assert.equal(ev.email, 'carol@example.com');
  });
});

describe('auth.login_failed event shape', () => {
  it('publishes error message without PII', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.login_failed', error: 'Token exchange failed: invalid_grant' });

    assert.equal(events.length, 1);
    const ev = events[0] as typeof events[0] & { error: string };
    assert.equal(ev.type, 'auth.login_failed');
    assert.ok(typeof ev.error === 'string' && ev.error.length > 0, 'error should be a non-empty string');
  });

  it('error field is a string (no structured PII objects)', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.login_failed', error: 'connection refused' });

    const ev = events[0] as typeof events[0] & { error: string };
    assert.equal(typeof ev.error, 'string');
  });
});

describe('auth.unauthorized event shape', () => {
  it('publishes path, method, and reason', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.unauthorized', path: '/api/repos', method: 'GET', reason: 'missing_token' });

    assert.equal(events.length, 1);
    const ev = events[0] as typeof events[0] & { path: string; method: string; reason: string };
    assert.equal(ev.type, 'auth.unauthorized');
    assert.equal(ev.path, '/api/repos');
    assert.equal(ev.method, 'GET');
    assert.equal(ev.reason, 'missing_token');
  });

  it('covers token_expired reason', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.unauthorized', path: '/api/search', method: 'POST', reason: 'token_expired' });

    const ev = events[0] as typeof events[0] & { reason: string };
    assert.equal(ev.reason, 'token_expired');
  });

  it('covers invalid_token reason', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    bus.publish({ type: 'auth.unauthorized', path: '/api/index', method: 'DELETE', reason: 'invalid_token' });

    const ev = events[0] as typeof events[0] & { reason: string; method: string };
    assert.equal(ev.reason, 'invalid_token');
    assert.equal(ev.method, 'DELETE');
  });
});

describe('auth events appear in eventBus.subscribe with correct envelope structure', () => {
  it('all auth event types include id and at fields from the bus', () => {
    const bus = new EventBus();
    const events = captureEvents(bus);

    const authEvents = [
      bus.publish({ type: 'auth.login', sub: 's', email: 'e@x', name: 'N', roles: ['member'], provider: 'entra' }),
      bus.publish({ type: 'auth.logout', sub: 's', email: 'e@x' }),
      bus.publish({ type: 'auth.token_refresh', sub: 's', email: 'e@x' }),
      bus.publish({ type: 'auth.login_failed', error: 'err' }),
      bus.publish({ type: 'auth.unauthorized', path: '/p', method: 'GET', reason: 'missing_token' }),
    ];

    assert.equal(events.length, 5);
    for (const ev of authEvents) {
      assert.ok(ev.id.startsWith('evt-'), `id should start with evt-, got: ${ev.id}`);
      assert.ok(ev.at, 'at should be present');
    }
  });
});
