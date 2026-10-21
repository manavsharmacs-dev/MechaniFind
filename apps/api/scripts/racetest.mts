// Stress test: 8 mechanics accept the same request at the same instant, 10 rounds.
// Exactly one must win each round, and nobody may get an error.
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { users, mechanicProfiles, serviceRequests, dispatchOffers, jobs } from '../src/db/schema.js';
import { acceptOffer } from '../src/dispatch/accept.js';

const N = 8, ROUNDS = 10;
const mechs = Array.from({ length: N }, (_, i) => `t_race${i}`);
const all = ['t_racedrv', ...mechs];
const clean = async () => {
  await db.execute(sql`delete from jobs where mechanic_id in (select id from users where id like 't_race%')`);
  await db.execute(sql`delete from dispatch_offers where mechanic_id in (select id from users where id like 't_race%')`);
  await db.execute(sql`delete from service_requests where driver_id = 't_racedrv'`);
  await db.execute(sql`delete from mechanic_profiles where user_id like 't_race%'`);
  await db.execute(sql`delete from users where id like 't_race%'`);
};
let ok = true;
try {
  await clean();
  await db.insert(users).values(all.map((id) => ({ id, name: id, email: `${id}@test.local`, role: id === 't_racedrv' ? 'driver' as const : 'mechanic' as const })));
  await db.insert(mechanicProfiles).values(mechs.map((userId) => ({ userId, serviceType: 'mobile' as const, isApproved: true, isAvailable: true, insuranceExpiresOn: '2099-01-01', location: { lng: -88.3, lat: 42.05 } })));
  for (let r = 1; r <= ROUNDS; r++) {
    const [req] = await db.insert(serviceRequests).values({ driverId: 't_racedrv', description: 'race', location: { lng: -88.4, lat: 42.06 } }).returning({ id: serviceRequests.id });
    await db.insert(dispatchOffers).values(mechs.map((mechanicId) => ({ requestId: req!.id, mechanicId, wave: 1 })));
    const results = await Promise.allSettled(mechs.map((m) => acceptOffer(req!.id, m)));
    const errors = results.filter((x) => x.status === 'rejected');
    const winners = results.filter((x) => x.status === 'fulfilled' && x.value.ok).length;
    if (errors.length || winners !== 1) { ok = false; console.log(`round ${r}: ${winners} winners, ${errors.length} errors`, errors.map((e: any) => String(e.reason?.cause?.message ?? e.reason).slice(0, 80))); }
    // A driver may only have one open request, so finish this one before the next round.
    await db.update(serviceRequests).set({ status: 'completed' }).where(eq(serviceRequests.id, req!.id));
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${ROUNDS} rounds x ${N} simultaneous accepts: exactly one winner each, no errors`);
} finally {
  await clean();
  await pool.end();
}
