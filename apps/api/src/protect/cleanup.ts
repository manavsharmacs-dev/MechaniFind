import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/**
 * Deletes old sign-in codes, rate-limit rows, usage counters and expired
 * sessions so a flood of requests can't slowly fill the (free-tier) database.
 */
export async function cleanupOldRows() {
  await db.execute(sql`delete from verifications where expires_at < now() - interval '1 day'`);
  await db.execute(sql`delete from rate_limits where last_request < (extract(epoch from now()) * 1000 - 86400000)`);
  await db.execute(sql`delete from usage_counters where window_start < now() - interval '7 days'`);
  await db.execute(sql`delete from sessions where expires_at < now() - interval '1 day'`);
  await db.execute(sql`delete from contact_change_approvals where expires_at < now() - interval '1 day'`);
}

export function startCleanupJob() {
  const run = () => cleanupOldRows().catch((e) => console.error('[cleanup] failed', e));
  run();
  setInterval(run, 60 * 60 * 1000).unref(); // hourly
}
