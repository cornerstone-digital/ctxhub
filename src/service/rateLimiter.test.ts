import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, extractClientIp } from './rateLimiter.js';

// ── RateLimiter ───────────────────────────────────────────────────────────────

test('allows requests up to the limit', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
  const now = Date.now();
  assert.equal(limiter.check('ip-1', now), true);
  assert.equal(limiter.check('ip-1', now + 100), true);
  assert.equal(limiter.check('ip-1', now + 200), true);
});

test('blocks requests that exceed the limit within the window', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
  const now = Date.now();
  limiter.check('ip-2', now);
  limiter.check('ip-2', now + 100);
  limiter.check('ip-2', now + 200);
  assert.equal(limiter.check('ip-2', now + 300), false);
  assert.equal(limiter.check('ip-2', now + 400), false);
});

test('resets the window after windowMs elapses', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
  const now = Date.now();
  limiter.check('ip-3', now);
  limiter.check('ip-3', now + 100);
  assert.equal(limiter.check('ip-3', now + 200), false, 'should be blocked before reset');
  // New window after 60 s
  assert.equal(limiter.check('ip-3', now + 60_001), true, 'should be allowed after window reset');
});

test('different keys are tracked independently', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
  const now = Date.now();
  limiter.check('ip-a', now);
  // ip-a is now at the limit; ip-b should still be allowed
  assert.equal(limiter.check('ip-a', now + 10), false);
  assert.equal(limiter.check('ip-b', now + 10), true);
});

test('remaining() reflects current window usage', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
  const now = Date.now();
  assert.equal(limiter.remaining('ip-5', now), 5);
  limiter.check('ip-5', now);
  assert.equal(limiter.remaining('ip-5', now + 10), 4);
  limiter.check('ip-5', now + 20);
  limiter.check('ip-5', now + 30);
  assert.equal(limiter.remaining('ip-5', now + 40), 2);
});

test('remaining() returns max after window expires', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, maxRequests: 5 });
  const now = Date.now();
  limiter.check('ip-6', now);
  limiter.check('ip-6', now + 100);
  assert.equal(limiter.remaining('ip-6', now + 2_000), 5);
});

test('reset() clears all state', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
  const now = Date.now();
  limiter.check('ip-r', now);
  assert.equal(limiter.check('ip-r', now + 10), false);
  limiter.reset();
  assert.equal(limiter.check('ip-r', now + 20), true);
});

// ── extractClientIp ───────────────────────────────────────────────────────────

test('extractClientIp prefers X-Forwarded-For', () => {
  const ip = extractClientIp({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, '127.0.0.1');
  assert.equal(ip, '10.0.0.1');
});

test('extractClientIp falls back to remoteAddress when no forwarded header', () => {
  const ip = extractClientIp({}, '192.168.1.100');
  assert.equal(ip, '192.168.1.100');
});

test('extractClientIp handles array X-Forwarded-For', () => {
  const ip = extractClientIp({ 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] }, '127.0.0.1');
  assert.equal(ip, '1.2.3.4');
});

test('extractClientIp returns "unknown" when no IP is available', () => {
  const ip = extractClientIp({}, undefined);
  assert.equal(ip, 'unknown');
});
