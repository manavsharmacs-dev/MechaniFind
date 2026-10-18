import type { Context, MiddlewareHandler } from 'hono';
import { clientIp } from './client-ip.js';
import { MemoryLimiter } from './memory-limiter.js';
import { RATE, SCANNER } from './limits.js';

const ipLimiter = new MemoryLimiter();
const userLimiter = new MemoryLimiter();
const badResponses = new MemoryLimiter();
const blocked = new MemoryLimiter();
const inFlight = new Map<string, number>();

function tooMany(c: Context, retryAfterSec: number, message = 'Too many requests. Slow down.') {
  c.header('Retry-After', String(retryAfterSec));
  return c.json({ error: 'rate_limited', message }, 429);
}

/**
 * Runs first on EVERY request, including to routes that don't exist:
 * 1. Blocked scanner IPs are turned away immediately.
 * 2. Per-IP rate limit.
 * 3. Per-IP cap on requests in progress at once.
 * 4. After the response: count 404/401/400s toward the scanner block.
 */
export const protect: MiddlewareHandler = async (c, next) => {
  const ip = clientIp(c);
  c.set('clientIp' as never, ip as never);

  const block = blocked.peek(ip);
  if (block) return tooMany(c, block.retryAfterSec, 'Temporarily blocked.');

  const rate = ipLimiter.hit(`ip:${ip}`, RATE.ipPerMinute, 60_000);
  c.header('RateLimit-Limit', String(RATE.ipPerMinute));
  c.header('RateLimit-Remaining', String(Math.max(0, RATE.ipPerMinute - rate.count)));
  if (!rate.ok) return tooMany(c, rate.retryAfterSec);

  const active = inFlight.get(ip) ?? 0;
  if (active >= RATE.ipConcurrent) return tooMany(c, 1);
  inFlight.set(ip, active + 1);
  try {
    await next();
  } finally {
    const n = (inFlight.get(ip) ?? 1) - 1;
    if (n <= 0) inFlight.delete(ip); else inFlight.set(ip, n);
  }

  if (SCANNER.badStatuses.has(c.res.status)) {
    const bad = badResponses.hit(`bad:${ip}`, SCANNER.badResponses, SCANNER.windowMinutes * 60_000);
    if (!bad.ok) {
      blocked.set(ip, 1, SCANNER.blockMinutes * 60_000);
      console.warn(`[protect] blocked ${ip} for ${SCANNER.blockMinutes} min (${bad.count} bad responses)`);
    }
  }
};

/** Per-account limit, applied once we know who's signed in (see requireAuth). */
export function checkUserRate(userId: string): { ok: boolean; retryAfterSec: number } {
  const r = userLimiter.hit(`user:${userId}`, RATE.userPerMinute, 60_000);
  return { ok: r.ok, retryAfterSec: r.retryAfterSec };
}

export { tooMany };
