// Test data for the mechanic dashboard.
//   tsx scripts/seed-dashboard.mts <mechanicPhone>   seed
//   tsx scripts/seed-dashboard.mts --clean           remove it
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { users, mechanicProfiles, serviceRequests, dispatchOffers, jobs } from '../src/db/schema.js';
import { acceptOffer } from '../src/dispatch/accept.js';

// One test driver per breakdown: a driver can only have one open request at a time.
const DRIVERS = ['t_dash_driver1', 't_dash_driver2', 't_dash_driver3', 't_dash_driver4'] as const;
const OTHER = 't_dash_other';

async function clean() {
  await db.execute(sql`delete from jobs where request_id in (select id from service_requests where driver_id like 't_dash_driver%')`);
  await db.execute(sql`delete from dispatch_offers where request_id in (select id from service_requests where driver_id like 't_dash_driver%')`);
  await db.execute(sql`delete from service_requests where driver_id like 't_dash_driver%'`);
  await db.execute(sql`delete from mechanic_profiles where user_id = ${OTHER}`);
  await db.execute(sql`delete from users where id like 't_dash_driver%' or id = ${OTHER}`);
}

async function newRequest(driverId: string, category: 'engine' | 'tires' | 'brakes', description: string) {
  const [r] = await db.insert(serviceRequests).values({
    driverId, description, category, requiredSpecialty: category === 'tires' ? 'tires' : 'engine',
    faultCode: 'SPN 3226 FMI 4', driverSaysDrivable: false, location: { lng: -88.4131, lat: 42.067 },
  }).returning({ id: serviceRequests.id });
  return r!.id;
}

try {
  await clean();
  const phone = process.argv[2];
  if (phone && phone !== '--clean') {
    const [mech] = await db.select({ id: users.id }).from(users).where(eq(users.phoneNumber, phone));
    if (!mech) throw new Error('mechanic not found');
    await db.insert(users).values([
      ...DRIVERS.map((id) => ({ id, name: 'Dash Driver', email: `${id}@test.local` })),
      { id: OTHER, name: 'Other Mechanic', email: 't_dash_other@test.local', role: 'mechanic' },
    ]);
    await db.insert(mechanicProfiles).values({ userId: OTHER, serviceType: 'mobile', isApproved: true, isAvailable: true, location: { lng: -88.3, lat: 42.05 } });

    // 1) A job this mechanic accepted and completed
    const done = await newRequest(DRIVERS[0], 'engine', 'Lost power on I-90');
    await db.insert(dispatchOffers).values({ requestId: done, mechanicId: mech.id, wave: 1, distanceMiles: 7.1 });
    const a = await acceptOffer(done, mech.id);
    if (!a.ok) throw new Error('accept 1 failed');
    await db.update(jobs).set({ status: 'completed', completedAt: new Date() }).where(eq(jobs.id, a.jobId));
    await db.update(serviceRequests).set({ status: 'completed' }).where(eq(serviceRequests.id, done));

    // 2) The job they're on right now
    const now = await newRequest(DRIVERS[1], 'tires', 'Blown steer tire, on the shoulder');
    await db.insert(dispatchOffers).values({ requestId: now, mechanicId: mech.id, wave: 1, distanceMiles: 3.3 });
    const b = await acceptOffer(now, mech.id);
    if (!b.ok) throw new Error('accept 2 failed');
    await db.update(jobs).set({ status: 'en_route', enRouteAt: new Date() }).where(eq(jobs.id, b.jobId));

    // 3) An offer waiting on them
    const waiting = await newRequest(DRIVERS[2], 'engine', 'Check engine light, losing boost');
    await db.insert(dispatchOffers).values({ requestId: waiting, mechanicId: mech.id, wave: 1, distanceMiles: 12.26 });

    // 4) An offer for SOMEONE ELSE — must never appear on this dashboard
    const notMine = await newRequest(DRIVERS[3], 'brakes', 'PRIVATE: other mechanic only');
    await db.insert(dispatchOffers).values({ requestId: notMine, mechanicId: OTHER, wave: 1, distanceMiles: 2 });
  }
  console.log('ok');
} finally {
  await pool.end();
}
