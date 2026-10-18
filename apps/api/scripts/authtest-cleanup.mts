// Removes data created by scripts/authtest.sh (test phones +1815555xxxx).
import { like, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { users, verifications, rateLimits } from '../src/db/schema.js';

const roles = await db.select({ phone: users.phoneNumber, role: users.role, email: users.email })
  .from(users).where(like(users.phoneNumber, '+1815555%'));
console.log('test users before cleanup:', JSON.stringify(roles));

await db.delete(users).where(like(users.phoneNumber, '+1815555%')); // sessions/accounts cascade
await db.delete(verifications).where(like(verifications.identifier, '+1815555%'));
await db.delete(rateLimits);
// Test quota counters (development database only).
await db.execute(sql`delete from usage_counters where scope like 'phone:+1815555%' or action like 'budget_%'`);
const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
console.log(`cleanup done, users left: ${n!.n}`);
await pool.end();
