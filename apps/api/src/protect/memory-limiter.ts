/**
 * Fast in-memory fixed-window counter. Used for per-request limits where a
 * database round-trip on every request would be too slow / too costly.
 * Bounded in size, so an attacker using thousands of IPs can't exhaust memory.
 */
const MAX_KEYS = 100_000;

export class MemoryLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  /** Counts one hit. Returns whether it's allowed and how long until the window resets. */
  hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number; count: number } {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.hits.set(key, entry);
      this.prune(now);
    }
    entry.count++;
    return {
      ok: entry.count <= limit,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      count: entry.count,
    };
  }

  /** Current count without adding a hit. */
  peek(key: string): { count: number; retryAfterSec: number } | null {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= Date.now()) return null;
    return { count: entry.count, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) };
  }

  set(key: string, count: number, windowMs: number) {
    this.hits.set(key, { count, resetAt: Date.now() + windowMs });
    this.prune(Date.now());
  }

  private prune(now: number) {
    if (this.hits.size <= MAX_KEYS) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    // Still too big (huge distributed attack): drop the oldest 10%.
    if (this.hits.size > MAX_KEYS) {
      let n = Math.ceil(this.hits.size * 0.1);
      for (const k of this.hits.keys()) { if (n-- <= 0) break; this.hits.delete(k); }
    }
  }
}

/** Caps how many copies of a slow/expensive task run at once. */
export class Semaphore {
  private active = 0;
  constructor(private readonly max: number) {}
  /** Runs fn if a slot is free; otherwise returns null immediately (caller answers "busy, retry"). */
  async tryRun<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.active >= this.max) return null;
    this.active++;
    try { return await fn(); } finally { this.active--; }
  }
}
