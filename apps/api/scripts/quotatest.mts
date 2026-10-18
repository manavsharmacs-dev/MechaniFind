import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { useQuota } from '../src/protect/quota.js';

const scope = `test:${Date.now()}`;
const results = await Promise.all(Array.from({ length: 100 }, () => useQuota('race', scope, 5, 'day')));
const allowed = results.filter((r) => r.ok).length;
console.log(`${allowed === 5 ? 'PASS' : 'FAIL'}  exactly 5 of 100 simultaneous uses allowed (got ${allowed})`);
await db.execute(sql`delete from usage_counters where scope = ${scope}`);
await pool.end();
