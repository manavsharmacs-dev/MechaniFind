// Admin tool: approve (or revoke) a mechanic from the command line.
//   npm run mechanic:approve -- +18155550123
//   npm run mechanic:approve -- shop@example.com --revoke
//   npm run mechanic:approve -- --list          (show everyone pending)
import { eq, or, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { mechanicProfiles, users } from '../src/db/schema.js';

const [who, flag] = process.argv.slice(2);
try {
  if (!who || who === '--list') {
    const rows = await db.select({
      business: mechanicProfiles.businessName, phone: users.phoneNumber, email: users.email,
      type: mechanicProfiles.serviceType, approved: mechanicProfiles.isApproved, since: mechanicProfiles.createdAt,
    }).from(mechanicProfiles).innerJoin(users, eq(users.id, mechanicProfiles.userId))
      .where(who === '--list' ? sql`not ${mechanicProfiles.isApproved}` : sql`true`);
    console.table(rows.map((r) => ({ ...r, email: r.email?.endsWith('.invalid') ? '' : r.email })));
  } else {
    const [user] = await db.select({ id: users.id }).from(users)
      .where(or(eq(users.phoneNumber, who), eq(users.email, who.toLowerCase())));
    if (!user) throw new Error(`No account with phone/email ${who}`);
    const approve = flag !== '--revoke';
    const [p] = await db.update(mechanicProfiles)
      .set(approve ? { isApproved: true } : { isApproved: false, isAvailable: false })
      .where(eq(mechanicProfiles.userId, user.id)).returning({ business: mechanicProfiles.businessName });
    if (!p) throw new Error('That account has no mechanic profile.');
    console.log(`${approve ? 'Approved' : 'Revoked'}: ${p.business}`);
  }
} catch (e) {
  console.error(String((e as Error).message));
  process.exitCode = 1;
} finally {
  await pool.end();
}
