import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mechanicProfiles, users, SPECIALTIES } from '../db/schema.js';
import { requireAuth, type AuthVars } from '../auth/middleware.js';
import { cleanText, jsonBody, usLocation } from '../lib/validate.js';
import { useQuota } from '../protect/quota.js';
import { AVAILABILITY, QUOTA } from '../protect/limits.js';
import { MemoryLimiter } from '../protect/memory-limiter.js';

// ---------- What a mechanic is allowed to send ----------
// .strict() = any extra field (isApproved, role, userId, ...) gets the request rejected.
const profileFields = {
  businessName: cleanText(2, 120),
  serviceType: z.enum(['mobile', 'shop', 'both']),
  specialties: z.array(z.enum(SPECIALTIES)).min(1).max(SPECIALTIES.length)
    .refine((a) => new Set(a).size === a.length, 'duplicates'),
  calloutFeeCents: z.number().int().min(0).max(100_000), // $0 – $1,000
  serviceRadiusMiles: z.number().int().min(1).max(100),
  location: usLocation,
  shopAddress: cleanText(5, 200).optional(),
};

const createSchema = z.object(profileFields).strict()
  .refine((p) => p.serviceType === 'mobile' || !!p.shopAddress, { path: ['shopAddress'], message: 'required for shops' });

const updateSchema = z.object(profileFields).partial().strict()
  .refine((p) => Object.keys(p).length > 0, 'nothing to update');

type Profile = typeof mechanicProfiles.$inferSelect;

const NAME_INTERVAL_MS = QUOTA.nameChangeIntervalDays * 24 * 60 * 60 * 1000;

/** When the business name may change again, or null if it can change now. */
function nextNameChangeAt(p: Profile): Date | null {
  if (!p.nameChangedAt) return null;
  const next = new Date(p.nameChangedAt.getTime() + NAME_INTERVAL_MS);
  return next > new Date() ? next : null;
}

/** Only what the mechanic's own app needs — never internal fields. */
function present(p: Profile) {
  return {
    businessName: p.businessName,
    serviceType: p.serviceType,
    specialties: p.specialties,
    calloutFeeCents: p.calloutFeeCents,
    serviceRadiusMiles: p.serviceRadiusMiles,
    location: p.location,
    shopAddress: p.shopAddress,
    status: p.isApproved ? 'approved' : 'pending',
    isAvailable: p.isAvailable,
    nextNameChangeAt: nextNameChangeAt(p)?.toISOString() ?? null,
  };
}

function nameLimit(c: Context, until: Date) {
  c.header('Retry-After', String(Math.ceil((until.getTime() - Date.now()) / 1000)));
  return c.json({
    error: 'name_change_limit',
    message: `You can change your business name once a week. Next change: ${until.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.`,
    nextNameChangeAt: until.toISOString(),
  }, 429);
}

export const mechanicRoutes = new Hono<AuthVars>();
mechanicRoutes.use('*', requireAuth);

/** Become a mechanic. Starts as "pending" until an admin approves. */
mechanicRoutes.post('/profile', jsonBody(createSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // Mechanics must be reachable by phone — drivers and dispatch depend on it.
  if (!user.phoneNumber || !user.phoneNumberVerified) {
    return c.json({ error: 'phone_required', message: 'Add and confirm your phone number first.' }, 409);
  }
  if (user.role === 'fleet_manager') {
    return c.json({ error: 'role_conflict', message: 'Fleet manager accounts can’t be mechanics.' }, 409);
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(mechanicProfiles).values({
      userId: user.id,
      businessName: body.businessName,
      serviceType: body.serviceType,
      specialties: body.specialties,
      calloutFeeCents: body.calloutFeeCents,
      serviceRadiusMiles: body.serviceRadiusMiles,
      location: body.location,
      shopAddress: body.shopAddress ?? null,
      lastLocationAt: new Date(),
      // Always start unapproved and offline, whatever the app sends.
      isApproved: false,
      isAvailable: false,
    }).onConflictDoNothing().returning();
    if (!row) return null; // already has a profile
    // Drivers become mechanics; admins keep admin.
    if (user.role === 'driver') await tx.update(users).set({ role: 'mechanic' }).where(eq(users.id, user.id));
    return row;
  });

  if (!created) return c.json({ error: 'already_exists', message: 'You already have a mechanic profile.' }, 409);
  return c.json(present(created), 201);
});

/** The signed-in mechanic's own profile. */
mechanicRoutes.get('/profile', async (c) => {
  const [p] = await db.select().from(mechanicProfiles).where(eq(mechanicProfiles.userId, c.get('user').id));
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json(present(p));
});

/**
 * Edit the profile. Prices, radius, specialties etc. can change any time.
 * The business name can change once a week, and a new name needs re-approval.
 */
mechanicRoutes.patch('/profile', jsonBody(updateSchema), async (c) => {
  const userId = c.get('user').id;
  const body = c.req.valid('json');

  const [current] = await db.select().from(mechanicProfiles).where(eq(mechanicProfiles.userId, userId));
  if (!current) return c.json({ error: 'not_found' }, 404);

  const next = { ...current, ...body };
  if (next.serviceType !== 'mobile' && !next.shopAddress) {
    return c.json({ error: 'invalid_input', fields: ['shopAddress'] }, 400);
  }

  const renaming = body.businessName !== undefined && body.businessName !== current.businessName;
  if (renaming) {
    const waitUntil = nextNameChangeAt(current);
    if (waitUntil) return nameLimit(c, waitUntil);
  }

  // Generous abuse cap on edits in general (a real mechanic never gets near it).
  const quota = await useQuota('profile_edit', `user:${userId}`, QUOTA.profileEditsPerUserPerDay, 'day');
  if (!quota.ok) return c.json({ error: 'rate_limited', message: 'Too many changes today. Try again tomorrow.' }, 429);

  const [updated] = await db.update(mechanicProfiles).set({
    ...body,
    ...(body.location ? { lastLocationAt: new Date() } : {}),
    // The admin approved a specific business — a new name needs a new look.
    ...(renaming ? { nameChangedAt: new Date(), isApproved: false, isAvailable: false } : {}),
  }).where(and(
    eq(mechanicProfiles.userId, userId),
    // Renames: the weekly check is part of the update itself, so two renames sent
    // at the same instant can't both get through.
    renaming
      ? or(isNull(mechanicProfiles.nameChangedAt),
          lte(mechanicProfiles.nameChangedAt, sql`now() - make_interval(days => ${QUOTA.nameChangeIntervalDays})`))
      : undefined,
  )).returning();

  if (!updated) return nameLimit(c, new Date(Date.now() + NAME_INTERVAL_MS));
  return c.json(present(updated));
});

// ---------- Availability ----------

const availabilitySchema = z.object({
  available: z.boolean(),
  location: usLocation.optional(),
}).strict()
  .refine((b) => !b.available || !!b.location, { path: ['location'], message: 'required to go online' });

/**
 * Go online (receive jobs) or offline.
 * Only approved mechanics can go online, and they must send where they are.
 */
mechanicRoutes.post('/availability', jsonBody(availabilitySchema), async (c) => {
  const userId = c.get('user').id;
  const { available, location } = c.req.valid('json');

  const [current] = await db.select({ isApproved: mechanicProfiles.isApproved })
    .from(mechanicProfiles).where(eq(mechanicProfiles.userId, userId));
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (available && !current.isApproved) {
    return c.json({ error: 'not_approved', message: 'Your profile is still being reviewed.' }, 403);
  }

  const [updated] = await db.update(mechanicProfiles).set(
    available
      ? { isAvailable: true, location: location!, lastLocationAt: new Date() }
      : { isAvailable: false },
  ).where(and(
    eq(mechanicProfiles.userId, userId),
    // Re-checked inside the update: approval can't be revoked between the check and the write.
    available ? eq(mechanicProfiles.isApproved, true) : undefined,
  )).returning();
  if (!updated) return c.json({ error: 'not_approved', message: 'Your profile is still being reviewed.' }, 403);
  return c.json(present(updated));
});

const pingLimiter = new MemoryLimiter();

/** While online, the app reports the mechanic's location (at most every 30s). */
mechanicRoutes.post('/location', jsonBody(z.object({ location: usLocation }).strict()), async (c) => {
  const userId = c.get('user').id;
  const ping = pingLimiter.hit(`ping:${userId}`, 1, AVAILABILITY.locationPingSeconds * 1000);
  if (!ping.ok) {
    c.header('Retry-After', String(ping.retryAfterSec));
    return c.json({ error: 'rate_limited', message: 'Location updates are limited to one every 30 seconds.' }, 429);
  }
  const { location } = c.req.valid('json');
  const [updated] = await db.update(mechanicProfiles)
    .set({ location, lastLocationAt: new Date() })
    .where(and(eq(mechanicProfiles.userId, userId), eq(mechanicProfiles.isAvailable, true)))
    .returning({ userId: mechanicProfiles.userId });
  // Offline mechanics' locations are not tracked.
  if (!updated) return c.json({ error: 'offline', message: 'Go online to share your location.' }, 409);
  return c.json({ ok: true });
});
