/**
 * In-memory sliding-window rate limiter for Worker isolates.
 * Prefer this over D1 for short-lived abuse protection (no schema change).
 */

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export function resetRateLimitForTests(): void {
  buckets.clear();
}

/**
 * @returns true if allowed, false if limited
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now(),
): boolean {
  const existing = buckets.get(key);
  if (!existing || nowMs - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: nowMs });
    return true;
  }
  if (existing.count >= limit) {
    return false;
  }
  existing.count += 1;
  return true;
}
