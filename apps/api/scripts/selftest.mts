import { sql, inArray, eq } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { users, mechanicProfiles, serviceRequests, dispatchOffers, jobs } from '../src/db/schema.js';
import { acceptOffer } from '../src/dispatch/accept.js';

const ids = ['t_driver', 't_mechA', 't_mechB', 't_mechC'];
const pass = (name: string, ok: boolean, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
const fails = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
let reqId: string | undefined;

// Clear leftovers from any earlier run that crashed mid-way.
const leftover = sql`('t_driver','t_mechA','t_mechB','t_mechC')`;
await db.execute(sql`delete from jobs where mechanic_id in ${leftover}`);
await db.execute(sql`delete from dispatch_offers where mechanic_id in ${leftover}`);
await db.execute(sql`delete from service_requests where driver_id in ${leftover}`);
await db.execute(sql`delete from mechanic_profiles where user_id in ${leftover}`);
await db.execute(sql`delete from users where id in ${leftover}`);

try {
  await db.insert(users).values([
    { id: 't_driver', name: 'Test Driver', email: 't_driver@test.local', phoneNumber: '+18475550100' },
    { id: 't_mechA', name: 'Mech A', email: 't_mecha@test.local', role: 'mechanic' },
    { id: 't_mechB', name: 'Mech B', email: 't_mechb@test.local', role: 'mechanic' },
    { id: 't_mechC', name: 'Mech C', email: 't_mechc@test.local', role: 'mechanic' },
  ]);
  await db.insert(mechanicProfiles).values([
    // Elgin (~7 mi from Pingree Grove), Rockford (~37 mi)
    { userId: 't_mechA', serviceType: 'mobile', specialties: ['engine', 'electrical'], location: { lng: -88.2812, lat: 42.0354 }, isAvailable: true, isApproved: true, calloutFeeCents: 15000, insuranceExpiresOn: '2099-01-01' },
    { userId: 't_mechB', serviceType: 'mobile', specialties: ['engine'], location: { lng: -89.0940, lat: 42.2711 }, isAvailable: true, isApproved: true, insuranceExpiresOn: '2099-01-01' },
    { userId: 't_mechC', serviceType: 'shop', specialties: ['tires'], location: { lng: -88.30, lat: 42.05 }, isAvailable: true, isApproved: false },
  ]);

  const breakdown = { lng: -88.4131, lat: 42.0670 }; // Pingree Grove
  const point = sql`ST_SetSRID(ST_MakePoint(${breakdown.lng}, ${breakdown.lat}), 4326)::geography`;

  // 1. Distance search in MILES, approved + available + specialty only
  const within = async (miles: number) => db.select({
      id: mechanicProfiles.userId,
      miles: sql<number>`round((ST_Distance(${mechanicProfiles.location}, ${point}) / 1609.344)::numeric, 1)`,
    }).from(mechanicProfiles).where(sql`${mechanicProfiles.isAvailable} and ${mechanicProfiles.isApproved}
      and ${mechanicProfiles.specialties} @> array['engine']::specialty[]
      and ST_DWithin(${mechanicProfiles.location}, ${point}, ${miles * 1609.344})`);
  const w15 = await within(15), w60 = await within(60);
  pass('15-mile search finds only Mech A', w15.length === 1 && w15[0]!.id === 't_mechA', JSON.stringify(w15));
  pass('60-mile search finds A and B, not unapproved C', w60.length === 2 && !w60.some(r => r.id === 't_mechC'), JSON.stringify(w60));

  // 2. Location round-trips as {lng, lat}
  const [a] = await db.select({ loc: mechanicProfiles.location }).from(mechanicProfiles).where(eq(mechanicProfiles.userId, 't_mechA'));
  pass('location reads back as lng/lat', Math.abs(a!.loc!.lng + 88.2812) < 1e-9 && Math.abs(a!.loc!.lat - 42.0354) < 1e-9, JSON.stringify(a!.loc));

  // 3. Race: A and B accept at the same instant
  const [r] = await db.insert(serviceRequests).values({ driverId: 't_driver', description: 'Losing power, check engine light', faultCode: 'SPN 3226', category: 'engine', requiredSpecialty: 'engine', location: breakdown }).returning({ id: serviceRequests.id });
  reqId = r!.id;
  await db.insert(dispatchOffers).values([
    { requestId: reqId, mechanicId: 't_mechA', wave: 1 },
    { requestId: reqId, mechanicId: 't_mechB', wave: 1 },
  ]);
  const results = await Promise.all([acceptOffer(reqId, 't_mechA'), acceptOffer(reqId, 't_mechB')]);
  const winners = results.filter(x => x.ok).length;
  pass('simultaneous accepts: exactly one wins', winners === 1, JSON.stringify(results));
  const offers = await db.select({ m: dispatchOffers.mechanicId, s: dispatchOffers.status }).from(dispatchOffers).where(eq(dispatchOffers.requestId, reqId));
  pass('loser\'s offer expired', offers.some(o => o.s === 'accepted') && offers.some(o => o.s === 'expired'), JSON.stringify(offers));

  // 4. Safety constraints
  pass('job without an offer is rejected', await fails(() => db.insert(jobs).values({ requestId: reqId!, mechanicId: 't_mechC' })));
  pass('second active job on same request rejected', await fails(() => db.insert(jobs).values({ requestId: reqId!, mechanicId: 't_mechB' })));
  pass('negative call-out fee rejected', await fails(() => db.update(mechanicProfiles).set({ calloutFeeCents: -500 }).where(eq(mechanicProfiles.userId, 't_mechA'))));
  pass('radius over 100 mi rejected', await fails(() => db.update(mechanicProfiles).set({ serviceRadiusMiles: 500 }).where(eq(mechanicProfiles.userId, 't_mechA'))));
  pass('non-E.164 phone rejected', await fails(() => db.update(users).set({ phoneNumber: '815-555-0100' }).where(eq(users.id, 't_driver'))));
  pass('uppercase email rejected', await fails(() => db.update(users).set({ email: 'Bob@Test.local' }).where(eq(users.id, 't_driver'))));
  pass('unknown specialty rejected', await fails(() => db.execute(sql`update mechanic_profiles set specialties = array['wizardry']::specialty[] where user_id = 't_mechA'`)));
  pass('invalid coordinates rejected', await fails(() => db.update(mechanicProfiles).set({ location: { lng: 500, lat: 0 } }).where(eq(mechanicProfiles.userId, 't_mechA'))));
  pass('deleting a user with history is blocked', await fails(() => db.delete(users).where(eq(users.id, 't_mechA'))));

  // 5. Cancelled job frees the request for re-dispatch
  await db.update(jobs).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(jobs.requestId, reqId));
  await db.update(serviceRequests).set({ status: 'dispatching' }).where(eq(serviceRequests.id, reqId));
  await db.update(dispatchOffers).set({ status: 'pending' }).where(eq(dispatchOffers.mechanicId, 't_mechB'));
  await db.update(mechanicProfiles).set({ insuranceExpiresOn: sql`current_date` }).where(eq(mechanicProfiles.userId, 't_mechB'));
  const uninsured = await acceptOffer(reqId, 't_mechB');
  pass('mechanic with expired insurance can\'t accept', !uninsured.ok, JSON.stringify(uninsured));
  await db.update(mechanicProfiles).set({ insuranceExpiresOn: '2099-01-01' }).where(eq(mechanicProfiles.userId, 't_mechB'));
  const again = await acceptOffer(reqId, 't_mechB');
  pass('after cancellation, request can be re-accepted', again.ok, JSON.stringify(again));
} finally {
  if (reqId) {
    await db.delete(jobs).where(eq(jobs.requestId, reqId));
    await db.delete(dispatchOffers).where(eq(dispatchOffers.requestId, reqId));
    await db.delete(serviceRequests).where(eq(serviceRequests.id, reqId));
  }
  await db.delete(mechanicProfiles).where(inArray(mechanicProfiles.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  console.log(`cleanup done, users left: ${left!.n}`);
  await pool.end();
}
