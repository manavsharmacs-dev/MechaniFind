import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { COST_CAP } from './limits.js';

type Period = 'hour' | 'day';

/**
 * Uses one unit of a quota. Race-safe: 100 simultaneous calls against a limit
 * of 5 let exactly 5 through, because the database does the counting.
 *
 *   await useQuota('llm_message', `user:${id}`, 40, 'day')
 */
export async function useQuota(action: string, scope: string, limit: number, period: Period) {
  if (limit < 1) return { ok: false, used: 0 };
  const rows = await db.execute<{ count: number }>(sql`
    insert into usage_counters (scope, action, window_start, count)
    values (${scope}, ${action}, date_trunc(${period}, now()), 1)
    on conflict (scope, action, window_start)
    do update set count = usage_counters.count + 1
    where usage_counters.count < ${limit}
    returning count`);
  const row = rows.rows[0];
  return row ? { ok: true, used: Number(row.count) } : { ok: false, used: limit };
}

const alerted = new Set<string>();

/**
 * Whole-app daily spending cap for a paid feature. When the cap is hit the
 * feature pauses until tomorrow instead of running up a bill.
 */
export async function useBudget(kind: keyof typeof COST_CAP) {
  const cap = COST_CAP[kind];
  const result = await useQuota(`budget_${kind}`, 'global', cap, 'day');
  if (!result.ok) {
    const key = `${kind}:${new Date().toISOString().slice(0, 10)}`;
    if (!alerted.has(key)) {
      alerted.add(key);
      // TODO before launch: also email/text the founder here.
      console.error(`[COST CAP] Daily ${kind} cap of ${cap} reached — feature paused until midnight UTC.`);
    }
  }
  return result;
}
