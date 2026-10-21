import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dispatchOffers, jobs, mechanicProfiles, serviceRequests, users } from '../db/schema.js';

/** How long a mechanic has to accept an offer. */
export const OFFER_TTL_MINUTES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One generic failure on purpose: a mechanic can't use this endpoint to probe
// whether a request exists, was taken, or was never offered to them.
export type AcceptResult = { ok: true; jobId: string } | { ok: false; reason: 'unavailable' };

class Unavailable extends Error {}

/**
 * A mechanic accepts a breakdown. First come, first served — safe even if
 * several mechanics tap "accept" at the same instant.
 *
 * mechanicId must come from the logged-in session (requireAuth + requireRole('mechanic')),
 * never from the request body.
 */
export async function acceptOffer(requestId: string, mechanicId: string): Promise<AcceptResult> {
  if (!UUID.test(requestId)) return { ok: false, reason: 'unavailable' };
  try {
    return await db.transaction(async (tx) => {
      // 0. Lock the request row FIRST. Every accept for the same request now waits its
      //    turn here, which prevents deadlocks between simultaneous accepts.
      await tx.execute(sql`select 1 from ${serviceRequests} where ${serviceRequests.id} = ${requestId} for update`);

      // 1. This mechanic must hold a fresh pending offer, and still be approved, insured and active.
      const offer = await tx
        .update(dispatchOffers)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(and(
          eq(dispatchOffers.requestId, requestId),
          eq(dispatchOffers.mechanicId, mechanicId),
          eq(dispatchOffers.status, 'pending'),
          sql`${dispatchOffers.sentAt} > now() - make_interval(mins => ${OFFER_TTL_MINUTES})`,
          sql`exists (select 1 from ${mechanicProfiles} mp join ${users} u on u.id = mp.user_id
                      where mp.user_id = ${mechanicId} and mp.is_approved
                        and mp.insurance_expires_on > current_date and u.deleted_at is null)`,
        ))
        .returning({ id: dispatchOffers.id });
      if (offer.length === 0) throw new Unavailable();

      // 2. Claim the request only if it's still open. A mechanic who waited at step 0
      //    finds status != 'dispatching' here and gets 0 rows.
      const claimed = await tx
        .update(serviceRequests)
        .set({ status: 'assigned' })
        .where(and(eq(serviceRequests.id, requestId), eq(serviceRequests.status, 'dispatching')))
        .returning({ id: serviceRequests.id });
      if (claimed.length === 0) throw new Unavailable(); // undoes step 1

      // 3. Create the job, locking in the mechanic's current call-out fee.
      const [fee] = await tx.select({ cents: mechanicProfiles.calloutFeeCents })
        .from(mechanicProfiles).where(eq(mechanicProfiles.userId, mechanicId));
      const [job] = await tx.insert(jobs)
        .values({ requestId, mechanicId, calloutFeeCents: fee?.cents ?? null })
        .returning({ id: jobs.id });

      // 4. Everyone else's offer for this request is now expired.
      await tx
        .update(dispatchOffers)
        .set({ status: 'expired' })
        .where(and(
          eq(dispatchOffers.requestId, requestId),
          eq(dispatchOffers.status, 'pending'),
          ne(dispatchOffers.mechanicId, mechanicId),
        ));

      return { ok: true, jobId: job!.id } as const;
    });
  } catch (err) {
    if (err instanceof Unavailable) return { ok: false, reason: 'unavailable' };
    throw err;
  }
}
