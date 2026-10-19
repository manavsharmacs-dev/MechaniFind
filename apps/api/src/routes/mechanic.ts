import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mechanicProfiles, users, SPECIALTIES } from '../db/schema.js';
import { requireAuth, type AuthVars } from '../auth/middleware.js';
import { cleanText, jsonBody, usLocation } from '../lib/validate.js';
import { QUOTA } from '../protect/limits.js';

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

const EDIT_INTERVAL_MS = QUOTA.profileEditIntervalDays * 24 * 60 * 60 * 1000;

/** When this mechanic may edit again, or null if they can edit now. */
function nextEditAt(p: Profile): Date | null {
  if (!p.profileEditedAt) return null;
  const next = new Date(p.profileEditedAt.getTime() + EDIT_INTERVAL_MS);
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
    nextEditAt: nextEditAt(p)?.toISOString() ?? null,
  };
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
 * Edit the profile — once every 7 days (signing up doesn't count; rejected edits don't count).
 * Changing the business name sends it back for approval.
 */
mechanicRoutes.patch('/profile', jsonBody(updateSchema), async (c) => {
  const userId = c.get('user').id;
  const body = c.req.valid('json');

  const [current] = await db.select().from(mechanicProfiles).where(eq(mechanicProfiles.userId, userId));
  if (!current) return c.json({ error: 'not_found' }, 404);

  const waitUntil = nextEditAt(current);
  if (waitUntil) return weeklyLimit(c, waitUntil);

  const next = { ...current, ...body };
  if (next.serviceType !== 'mobile' && !next.shopAddress) {
    return c.json({ error: 'invalid_input', fields: ['shopAddress'] }, 400);
  }
  const renamed = body.businessName !== undefined && body.businessName !== current.businessName;

  // The "once a week" check is part of the update itself, so two edits sent at the
  // same instant can't both get through.
  const [updated] = await db.update(mechanicProfiles).set({
    ...body,
    ...(body.location ? { lastLocationAt: new Date() } : {}),
    // The admin approved a specific business — a new name needs a new look.
    ...(renamed ? { isApproved: false, isAvailable: false } : {}),
    profileEditedAt: new Date(),
  }).where(and(
    eq(mechanicProfiles.userId, userId),
    or(
      isNull(mechanicProfiles.profileEditedAt),
      lte(mechanicProfiles.profileEditedAt, sql`now() - make_interval(days => ${QUOTA.profileEditIntervalDays})`),
    ),
  )).returning();

  if (!updated) return weeklyLimit(c, new Date(Date.now() + EDIT_INTERVAL_MS));
  return c.json(present(updated));
});

function weeklyLimit(c: { json: (b: unknown, s: 429) => Response; header: (k: string, v: string) => void }, until: Date) {
  c.header('Retry-After', String(Math.ceil((until.getTime() - Date.now()) / 1000)));
  return c.json({
    error: 'edit_limit',
    message: `You can change your profile once a week. Next change: ${until.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.`,
    nextEditAt: until.toISOString(),
  }, 429);
}
