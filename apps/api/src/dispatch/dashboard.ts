import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { OFFER_TTL_MINUTES } from './accept.js';

const DEFAULT_TZ = 'America/Chicago';

/** Accepts only real IANA time zones (e.g. "America/Chicago"); anything else → default. */
export function safeTimeZone(tz: string | undefined): string {
  if (!tz || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v));

async function windowStats(mechanicId: string, startSql: ReturnType<typeof sql>) {
  const r = await db.execute<Row>(sql`
    select
      (select count(*) from jobs where mechanic_id = ${mechanicId}
         and status = 'completed' and completed_at >= ${startSql})               as completed,
      (select coalesce(sum(callout_fee_cents), 0) from jobs where mechanic_id = ${mechanicId}
         and status = 'completed' and completed_at >= ${startSql})               as fees,
      (select count(*) from dispatch_offers where mechanic_id = ${mechanicId}
         and sent_at >= ${startSql})                                             as received,
      (select count(*) from dispatch_offers where mechanic_id = ${mechanicId}
         and status = 'accepted' and sent_at >= ${startSql})                     as accepted,
      (select extract(epoch from avg(responded_at - sent_at)) from dispatch_offers
         where mechanic_id = ${mechanicId} and status = 'accepted' and sent_at >= ${startSql}) as avg_accept`);
  const s = r.rows[0] ?? {};
  const received = num(s.received);
  const accepted = num(s.accepted);
  return {
    jobsCompleted: num(s.completed),
    calloutFeesCents: num(s.fees),
    offersReceived: received,
    offersAccepted: accepted,
    acceptanceRate: received ? Math.round((accepted / received) * 100) / 100 : null,
    avgSecondsToAccept: s.avg_accept == null ? null : Math.round(Number(s.avg_accept)),
  };
}

/**
 * Everything the mechanic's home screen needs, in one round trip.
 * Every query is scoped to this mechanic's own id.
 */
export async function buildDashboard(mechanicId: string, tz: string) {
  const dayStart = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
  const weekStart = sql`(date_trunc('week', now() at time zone ${tz}) at time zone ${tz})`;

  // Offers waiting on this mechanic. The driver's exact location is NOT included —
  // only an approximate distance — until the mechanic accepts.
  const offers = await db.execute<Row>(sql`
    select o.id as offer_id, o.request_id, o.sent_at,
           round(o.distance_miles::numeric * 2) / 2 as approx_miles,
           r.category, r.required_specialty, r.fault_code, r.driver_says_drivable,
           left(r.description, 280) as description
    from dispatch_offers o
    join service_requests r on r.id = o.request_id
    where o.mechanic_id = ${mechanicId}
      and o.status = 'pending'
      and r.status = 'dispatching'
      and o.sent_at > now() - make_interval(mins => ${OFFER_TTL_MINUTES})
    order by o.sent_at desc
    limit 10`);

  // The job they're on right now (once accepted, they get the exact location).
  const active = await db.execute<Row>(sql`
    select j.id, j.status, j.accepted_at, j.en_route_at, j.arrived_at, j.callout_fee_cents,
           r.category, r.fault_code, r.driver_says_drivable, r.description,
           ST_Y(r.location::geometry) as lat, ST_X(r.location::geometry) as lng
    from jobs j
    join service_requests r on r.id = j.request_id
    where j.mechanic_id = ${mechanicId} and j.status in ('accepted', 'en_route', 'arrived')
    order by j.accepted_at desc
    limit 1`);

  const history = await db.execute<Row>(sql`
    select j.id, j.status, coalesce(j.completed_at, j.cancelled_at) as finished_at,
           j.callout_fee_cents, r.category
    from jobs j
    join service_requests r on r.id = j.request_id
    where j.mechanic_id = ${mechanicId} and j.status in ('completed', 'cancelled')
    order by coalesce(j.completed_at, j.cancelled_at) desc nulls last
    limit 20`);

  const a = active.rows[0];
  return {
    offers: offers.rows.map((o) => ({
      offerId: o.offer_id,
      requestId: o.request_id,
      category: o.category,
      requiredSpecialty: o.required_specialty,
      faultCode: o.fault_code,
      driverSaysDrivable: o.driver_says_drivable,
      description: o.description,
      approxMiles: o.approx_miles == null ? null : Number(o.approx_miles),
      sentAt: o.sent_at,
      expiresAt: new Date(new Date(String(o.sent_at)).getTime() + OFFER_TTL_MINUTES * 60_000).toISOString(),
    })),
    activeJob: a
      ? {
          jobId: a.id,
          status: a.status,
          acceptedAt: a.accepted_at,
          enRouteAt: a.en_route_at,
          arrivedAt: a.arrived_at,
          calloutFeeCents: a.callout_fee_cents == null ? null : Number(a.callout_fee_cents),
          category: a.category,
          faultCode: a.fault_code,
          driverSaysDrivable: a.driver_says_drivable,
          description: a.description,
          location: { lat: Number(a.lat), lng: Number(a.lng) },
        }
      : null,
    stats: {
      timeZone: tz,
      today: await windowStats(mechanicId, dayStart),
      thisWeek: await windowStats(mechanicId, weekStart),
    },
    history: history.rows.map((h) => ({
      jobId: h.id,
      status: h.status,
      finishedAt: h.finished_at,
      calloutFeeCents: h.callout_fee_cents == null ? null : Number(h.callout_fee_cents),
      category: h.category,
    })),
  };
}
