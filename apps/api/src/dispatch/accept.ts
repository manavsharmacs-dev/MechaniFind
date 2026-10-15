import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dispatchOffers, jobs, serviceRequests } from '../db/schema.js';

export type AcceptResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: 'already_taken' | 'no_pending_offer' };

class NoPendingOffer extends Error {}

/**
 * A mechanic accepts a breakdown. First come, first served — safe even if
 * several mechanics tap "accept" at the same instant.
 *
 * mechanicId must come from the logged-in session, never from the request body.
 */
export async function acceptOffer(requestId: string, mechanicId: string): Promise<AcceptResult> {
  try {
    return await db.transaction(async (tx) => {
      // 1. Claim the request only if it's still open. Postgres locks the row, so a
      //    second mechanic waits here, then finds status != 'dispatching' and gets 0 rows.
      const claimed = await tx
        .update(serviceRequests)
        .set({ status: 'assigned' })
        .where(and(eq(serviceRequests.id, requestId), eq(serviceRequests.status, 'dispatching')))
        .returning({ id: serviceRequests.id });
      if (claimed.length === 0) return { ok: false, reason: 'already_taken' } as const;

      // 2. This mechanic must actually hold a pending offer for this request.
      const offer = await tx
        .update(dispatchOffers)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(and(
          eq(dispatchOffers.requestId, requestId),
          eq(dispatchOffers.mechanicId, mechanicId),
          eq(dispatchOffers.status, 'pending'),
        ))
        .returning({ id: dispatchOffers.id });
      if (offer.length === 0) throw new NoPendingOffer(); // undoes step 1

      // 3. Create the job.
      const [job] = await tx.insert(jobs).values({ requestId, mechanicId }).returning({ id: jobs.id });

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
    if (err instanceof NoPendingOffer) return { ok: false, reason: 'no_pending_offer' };
    throw err;
  }
}
