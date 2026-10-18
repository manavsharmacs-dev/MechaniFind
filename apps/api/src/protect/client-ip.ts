import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../env.js';

/**
 * The ONE trusted answer to "who is calling?". Everything (our limits and
 * Better Auth's) uses this, so nobody can dodge limits by faking headers.
 *
 * - No proxy configured: use the real TCP connection address. Headers like
 *   X-Forwarded-For are ignored, so they can't be spoofed.
 * - Behind Cloudflare/Render: trust only the header that proxy sets.
 */
export function clientIp(c: Context): string {
  const header = env.TRUST_PROXY_HEADER;
  if (header) {
    const raw = c.req.header(header);
    if (raw) {
      // X-Forwarded-For is "client, proxy1, proxy2": the last entry was added by
      // our own proxy, so it's the only one we can trust.
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const ip = header === 'x-forwarded-for' ? parts[parts.length - 1] : parts[0];
      if (ip) return normalize(ip);
    }
  }
  try {
    return normalize(getConnInfo(c).remote.address ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

function normalize(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
