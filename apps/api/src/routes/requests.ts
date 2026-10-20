import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dispatchOffers, serviceRequests, ISSUE_CATEGORIES, type SPECIALTIES } from '../db/schema.js';
import { requireAuth, type AuthVars } from '../auth/middleware.js';
import { cleanText, jsonBody, usLocation } from '../lib/validate.js';
import { useQuota } from '../protect/quota.js';
import { QUOTA } from '../protect/limits.js';

// ============================================================================
// Fragment 2: what a driver is allowed to send
// ============================================================================

/**
 * The server — not the app — decides which mechanic specialty a breakdown needs.
 * The app can't ask for a mismatched specialty to reach a different set of mechanics.
 */
const SPECIALTY_FOR: Record<(typeof ISSUE_CATEGORIES)[number], (typeof SPECIALTIES)[number]> = {
  engine: 'engine',
  transmission: 'transmission',
  electrical: 'electrical',
  brakes: 'brakes',
  tires: 'tires',
  suspension: 'suspension',
  aftertreatment: 'aftertreatment',
  hvac: 'hvac',
  reefer: 'reefer',
  hydraulics: 'hydraulics',
  trailer: 'trailer',
  fuel: 'engine',   // fuel system problems go to engine mechanics
  other: 'general', // anything else goes to general repair
};

// .strict(): any extra field (driverId, companyId, status, requiredSpecialty...) rejects the request.
const createSchema = z.object({
  description: cleanText(5, 2000),          // the driver's own words
  faultCode: cleanText(1, 40).optional(),   // e.g. "SPN 3226 FMI 4"
  category: z.enum(ISSUE_CATEGORIES),
  driverSaysDrivable: z.boolean(),          // the driver's report — we never judge it
  location: usLocation,                     // where the truck is
}).strict();

const cancelSchema = z.object({
  reason: cleanText(2, 200).optional(),
}).strict();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Open" = still looking for a mechanic, or a mechanic is assigned.
// Must match the one_open_request_per_driver index in schema.ts.
const OPEN_STATUSES = ['dispatching', 'assigned'] as const;

type RequestRow = typeof serviceRequests.$inferSelect;

/** Only what the driver's own app needs. Never internal fields. */
function present(r: RequestRow) {
  return {
    id: r.id,
    status: r.status,
    category: r.category,
    requiredSpecialty: r.requiredSpecialty,
    faultCode: r.faultCode,
    description: r.description,
    driverSaysDrivable: r.driverSaysDrivable,
    location: r.location,
    createdAt: r.createdAt,
    cancelledAt: r.cancelledAt,
  };
}

export const requestRoutes = new Hono<AuthVars>();
requestRoutes.use('*', requireAuth);

// ============================================================================
// Fragment 3: a driver reports a breakdown
// ============================================================================

/**
 * POST /requests — report a breakdown.
 * Drivers only · confirmed phone required · one open request at a time · 5 per day.
 */
requestRoutes.post('/', jsonBody(createSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // 1. Who: drivers only (role comes from the database, never the request).
  if (user.role !== 'driver') {
    return c.json({ error: 'drivers_only', message: 'Only driver accounts can report breakdowns.' }, 403);
  }
  // 2. Reachable + harder to fake: a confirmed phone number is required.
  if (!user.phoneNumber || !user.phoneNumberVerified) {
    return c.json({ error: 'phone_required', message: 'Add and confirm your phone number so the mechanic can reach you.' }, 409);
  }

  // 3. One open breakdown at a time (fast, friendly check; the database index is the real guarantee).
  const [open] = await db.select({ id: serviceRequests.id }).from(serviceRequests)
    .where(and(eq(serviceRequests.driverId, user.id), inArray(serviceRequests.status, [...OPEN_STATUSES])));
  if (open) {
    return c.json({ error: 'already_open', message: 'You already have an open request.', requestId: open.id }, 409);
  }

  // 4. Daily limit — stops fake-breakdown spam from wasting mechanics' time.
  const quota = await useQuota('breakdown', `user:${user.id}`, QUOTA.breakdownRequestsPerUserPerDay, 'day');
  if (!quota.ok) {
    return c.json({ error: 'rate_limited', message: 'Daily limit reached. Call roadside assistance if you need help now.' }, 429);
  }

  // 5. Save it. Everything identifying comes from the session, not the body.
  try {
    const [row] = await db.insert(serviceRequests).values({
      driverId: user.id,
      companyId: user.companyId ?? null,             // from the account, never the app
      description: body.description,
      faultCode: body.faultCode ?? null,
      category: body.category,
      requiredSpecialty: SPECIALTY_FOR[body.category], // decided by the server
      driverSaysDrivable: body.driverSaysDrivable,
      location: body.location,
      status: 'dispatching',
    }).returning();
    return c.json(present(row!), 201);
  } catch (err) {
    // Two taps at the same instant: the database index refused the second one.
    if (isUniqueViolation(err, 'one_open_request_per_driver')) {
      return c.json({ error: 'already_open', message: 'You already have an open request.' }, 409);
    }
    throw err;
  }
});

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } })?.cause ?? (err as { code?: string; constraint?: string });
  return cause?.code === '23505' && cause?.constraint === constraint;
}
