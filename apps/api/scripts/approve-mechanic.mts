// Admin tool: approve (or revoke) a mechanic from the command line.
//   npm run mechanic:approve -- +18155550123
//   npm run mechanic:approve -- shop@example.com --revoke
//   npm run mechanic:approve -- --list          (show everyone pending)
//   npm run mechanic:approve                    (show everyone)
// Every view, change and refused attempt is written to admin_audit_log.
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { mechanicProfiles, users } from '../src/db/schema.js';
import { audit, cliActor } from '../src/admin/audit.js';

const MAX_LIST = 200; // keeps each view's log row a complete record of who was shown
const actor = cliActor();
const [who, flag] = process.argv.slice(2);

try {
  if (!who || who === '--list') {
    const pendingOnly = who === '--list';
    const rows = await db.select({
      userId: mechanicProfiles.userId,
      business: mechanicProfiles.businessName, phone: users.phoneNumber, email: users.email,
      type: mechanicProfiles.serviceType, approved: mechanicProfiles.isApproved, since: mechanicProfiles.createdAt,
      place: sql<string>`coalesce(${mechanicProfiles.shopAddress}, ${mechanicProfiles.serviceArea})`,
      llc: sql<string>`${mechanicProfiles.llcState} || ' ' || ${mechanicProfiles.llcNumber}`,
      ein: mechanicProfiles.ein, usdot: mechanicProfiles.usdotNumber, mc: mechanicProfiles.mcNumber,
      insurer: mechanicProfiles.insuranceProvider, policy: mechanicProfiles.insurancePolicyNumber,
      coverage: mechanicProfiles.insuranceCoverageDollars, insuredUntil: mechanicProfiles.insuranceExpiresOn,
    }).from(mechanicProfiles).innerJoin(users, eq(users.id, mechanicProfiles.userId))
      .where(pendingOnly ? sql`not ${mechanicProfiles.isApproved}` : sql`true`)
      .orderBy(asc(mechanicProfiles.createdAt))
      .limit(MAX_LIST + 1);
    const shown = rows.slice(0, MAX_LIST);

    // Log BEFORE showing anything. If this fails, nothing is printed.
    await audit(db, {
      ...actor, action: 'mechanic.list', targetType: 'mechanic',
      details: {
        filter: pendingOnly ? 'pending' : 'all',
        shownCount: shown.length,
        mechanicIds: shown.map((r) => r.userId),
        fieldsShown: ['business', 'phone', 'email', 'place', 'llc', 'fullEin', 'usdot', 'mc', 'insurance'],
      },
    });

    console.table(shown.map(({ userId: _id, ...r }) => ({ ...r, email: r.email?.endsWith('.invalid') ? '' : r.email })));
    if (rows.length > MAX_LIST) console.log(`Showing the first ${MAX_LIST}. Approve some, then list again.`);
  } else {
    const approve = flag !== '--revoke';
    const action = approve ? 'mechanic.approve' : 'mechanic.revoke';
    if (flag !== undefined && flag !== '--revoke') throw new Error(`Unknown option ${flag}. Use --revoke or nothing.`);

    const [user] = await db.select({ id: users.id }).from(users)
      .where(or(eq(users.phoneNumber, who), eq(users.email, who.toLowerCase())));
    if (!user) {
      await audit(db, { ...actor, action, outcome: 'refused', targetType: 'mechanic',
        details: { reason: 'no_account', lookedUpBy: who.includes('@') ? 'email' : 'phone' } });
      throw new Error(`No account with phone/email ${who}`);
    }

    // The change and its log row commit together, or neither does.
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select({
        isApproved: mechanicProfiles.isApproved, isAvailable: mechanicProfiles.isAvailable,
      }).from(mechanicProfiles).where(eq(mechanicProfiles.userId, user.id)).for('update');

      if (!before) {
        await audit(tx, { ...actor, action, outcome: 'refused', targetType: 'mechanic', targetId: user.id,
          details: { reason: 'no_mechanic_profile' } });
        return { ok: false as const, message: 'That account has no mechanic profile.' };
      }

      const [after] = await tx.update(mechanicProfiles)
        .set(approve ? { isApproved: true } : { isApproved: false, isAvailable: false })
        .where(and(
          eq(mechanicProfiles.userId, user.id),
          // Never approve without business details and insurance that's still valid.
          approve ? sql`${mechanicProfiles.llcNumber} is not null and ${mechanicProfiles.ein} is not null
            and ${mechanicProfiles.insurancePolicyNumber} is not null and ${mechanicProfiles.insuranceExpiresOn} > current_date
            and (case when ${mechanicProfiles.serviceType} = 'mobile' then ${mechanicProfiles.serviceArea}
                      else ${mechanicProfiles.shopAddress} end) is not null` : undefined,
        )).returning({
          business: mechanicProfiles.businessName,
          isApproved: mechanicProfiles.isApproved, isAvailable: mechanicProfiles.isAvailable,
        });

      if (!after) {
        await audit(tx, { ...actor, action, outcome: 'refused', targetType: 'mechanic', targetId: user.id,
          details: { reason: 'missing_details_or_expired_insurance', before } });
        return { ok: false as const, message: 'It is missing business/insurance details or the insurance has expired.' };
      }

      await audit(tx, { ...actor, action, targetType: 'mechanic', targetId: user.id,
        details: {
          business: after.business,
          before,
          after: { isApproved: after.isApproved, isAvailable: after.isAvailable },
        } });
      return { ok: true as const, business: after.business };
    });

    if (!result.ok) throw new Error(result.message);
    console.log(`${approve ? 'Approved' : 'Revoked'}: ${result.business}`);
  }
} catch (e) {
  console.error(String((e as Error).message));
  process.exitCode = 1;
} finally {
  await pool.end();
}
