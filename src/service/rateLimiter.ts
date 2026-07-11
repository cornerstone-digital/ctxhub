// In-memory rate limiter — no external dependencies, suitable for a single-process service.
// State resets on service restart (intentional: this is a simple DoS guard, not a persistent
// quota system). Uses whole-window sliding: the window resets from the first request in it,
// not from each individual request.

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimiterOptions {
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per window. */
  maxRequests: number;
}

export class RateLimiter {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(opts: RateLimiterOptions) {
    this.windowMs = opts.windowMs;
    this.maxRequests = opts.maxRequests;
  }

  /**
   * Check and record a request from `key`. Returns true when the request is
   * allowed, false when it exceeds the limit. Pass `now` for testability.
   */
  check(key: string, now = Date.now()): boolean {
    const entry = this.store.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      // First request in a new window.
      this.store.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.maxRequests;
  }

  /** Remaining requests in the current window for `key`. For testing/inspection only. */
  remaining(key: string, now = Date.now()): number {
    const entry = this.store.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) return this.maxRequests;
    return Math.max(0, this.maxRequests - entry.count);
  }

  /** Clear all state. Useful for testing. */
  reset(): void {
    this.store.clear();
  }
}

/** Extract the client IP from an HTTP request. Prefers X-Forwarded-For (proxy/load-balancer). */
export function extractClientIp(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): string {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim();
  }
  return remoteAddress ?? 'unknown';
}
