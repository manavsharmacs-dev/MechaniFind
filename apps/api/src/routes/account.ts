// Approving a contact change with the OLD contact (fix B).
//
// Replacing an existing email or phone takes two steps before the normal change flow:
//   POST /account/contact-change/start    { channel, newValue }  → code sent to the CURRENT email/phone
//   POST /account/contact-change/confirm  { channel, code }      → approval for that exact newValue (10 min)
// Then the usual sign-in routes change it (they refuse a replacement without this approval — fragment B3).
// Adding a first email/phone doesn't need this (a recent sign-in is enough — fix A).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { contactChangeApprovals, CONTACT_CHANNELS } from '../db/schema.js';
import { requireAuth, type AuthVars } from '../auth/middleware.js';
import { guardCodeSend, signedInRecently, US_PHONE } from '../auth/auth.js';
import { emailProblem, isPlaceholderEmail, normalizeEmail } from '../auth/email.js';
import { sendContactChangeCode } from '../auth/send-code.js';
import { clientIp } from '../protect/client-ip.js';
import { jsonBody } from '../lib/validate.js';

const CODE_MINUTES = 10;     // the old-contact code expires after this
const APPROVAL_MINUTES = 10; // once approved, time left to finish the new-contact step
const MAX_TRIES = 3;         // wrong guesses before the code is dead (must match the DB check)

type Channel = (typeof CONTACT_CHANNELS)[number];
type User = AuthVars['Variables']['user'];

const startSchema = z.object({
  channel: z.enum(CONTACT_CHANNELS),
  newValue: z.string().max(254),
}).strict();

const confirmSchema = z.object({
  channel: z.enum(CONTACT_CHANNELS),
  code: z.string().regex(/^\d{6}$/),
}).strict();

/** Codes are stored as a keyed hash, tied to the account and channel. The code itself is never stored. */
const hashCode = (userId: string, channel: Channel, code: string) =>
  createHmac('sha256', env.BETTER_AUTH_SECRET).update(`contact-change:${userId}:${channel}:${code}`).digest('hex');

export const maskEmail = (e: string) => { const [local = '', domain = ''] = e.split('@'); return `${local.slice(0, 1)}***@${domain}`; };
export const maskPhone = (p: string) => `***-***-${p.slice(-4)}`;
const mask = (channel: Channel, v: string) => (channel === 'email' ? maskEmail(v) : maskPhone(v));

/** The email/phone this account has now, or null when there's nothing to replace. */
function currentContact(user: User, channel: Channel): string | null {
  if (channel === 'email') return isPlaceholderEmail(user.email) ? null : normalizeEmail(user.email);
  return user.phoneNumber && user.phoneNumberVerified ? user.phoneNumber : null;
}

export const accountRoutes = new Hono<AuthVars>();
accountRoutes.use('*', requireAuth);
// Same rule as fix A: only within 10 minutes of signing in.
accountRoutes.use('*', async (c, next) => {
  if (!signedInRecently(c.get('session').createdAt)) {
    return c.json({ error: 'reauth_required', message: 'For your security, sign in again to add or change your email or phone number.' }, 403);
  }
  await next();
});

/** Step 1: send a code to the CURRENT email/phone to approve replacing it. */
accountRoutes.post('/contact-change/start', jsonBody(startSchema), async (c) => {
  const user = c.get('user');
  const { channel, newValue: raw } = c.req.valid('json');

  const old = currentContact(user, channel);
  if (!old) {
    return c.json({ error: 'nothing_to_replace', message: `You don't have ${channel === 'email' ? 'an email' : 'a phone number'} yet. Add it directly.` }, 400);
  }

  let newValue: string;
  if (channel === 'email') {
    newValue = normalizeEmail(raw);
    const problem = emailProblem(newValue);
    if (problem) return c.json({ error: problem === 'disposable' ? 'disposable_email' : 'invalid_email' }, 400);
  } else {
    newValue = raw.trim();
    if (!US_PHONE.test(newValue)) return c.json({ error: 'invalid_phone' }, 400);
  }
  if (newValue === old) return c.json({ error: 'same_as_current' }, 400);
  // Deliberately NOT checking whether newValue belongs to another account: the answer
  // would let anyone test which emails/phones are registered. The final step fails quietly instead.

  // Same hourly limits as sign-in codes, counted against the OLD contact (it receives the code).
  try {
    await guardCodeSend(channel === 'email' ? 'email' : 'sms', old, clientIp(c));
  } catch (e) {
    if (e instanceof APIError) {
      const unavailable = e.statusCode === 503;
      return c.json({ error: unavailable ? 'unavailable' : 'rate_limited', message: e.message }, unavailable ? 503 : 429);
    }
    throw e;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const fields = {
    newValue,
    codeHash: hashCode(user.id, channel, code),
    attempts: 0,
    expiresAt: sql`now() + make_interval(mins => ${CODE_MINUTES})`,
    approvedAt: null,
    createdAt: sql`now()`,
  };
  // Starting again replaces any earlier pending/approved change for this channel (fresh code, fresh tries).
  await db.insert(contactChangeApprovals).values({ userId: user.id, channel, ...fields })
    .onConflictDoUpdate({ target: [contactChangeApprovals.userId, contactChangeApprovals.channel], set: fields });

  await sendContactChangeCode(channel, old, code, mask(channel, newValue));
  return c.json({ ok: true, sentTo: mask(channel, old), expiresInMinutes: CODE_MINUTES });
});

/** Step 2: check the code from the old contact. Approves the change to that exact new value. */
accountRoutes.post('/contact-change/confirm', jsonBody(confirmSchema), async (c) => {
  const user = c.get('user');
  const { channel, code } = c.req.valid('json');
  const where = and(eq(contactChangeApprovals.userId, user.id), eq(contactChangeApprovals.channel, channel));

  // Count the try FIRST, atomically, so parallel guesses can't exceed 3.
  const [row] = await db.update(contactChangeApprovals)
    .set({ attempts: sql`${contactChangeApprovals.attempts} + 1` })
    .where(and(where, isNull(contactChangeApprovals.approvedAt),
      gt(contactChangeApprovals.expiresAt, sql`now()`), lt(contactChangeApprovals.attempts, MAX_TRIES)))
    .returning({ codeHash: contactChangeApprovals.codeHash, attempts: contactChangeApprovals.attempts });

  const dead = { error: 'invalid_code', message: 'That code is wrong or has expired. Start again to get a new one.' };
  if (!row) return c.json(dead, 400);

  const right = timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(hashCode(user.id, channel, code), 'hex'));
  if (!right) {
    const attemptsLeft = MAX_TRIES - row.attempts;
    return c.json(attemptsLeft > 0 ? { error: 'invalid_code', message: 'That code is wrong.', attemptsLeft } : dead, 400);
  }

  // Approve — only the exact row we checked (a newer "start" replaces the code hash, so it can't be approved by an old code).
  const [approved] = await db.update(contactChangeApprovals)
    .set({ approvedAt: sql`now()`, expiresAt: sql`now() + make_interval(mins => ${APPROVAL_MINUTES})` })
    .where(and(where, isNull(contactChangeApprovals.approvedAt), eq(contactChangeApprovals.codeHash, row.codeHash)))
    .returning({ newValue: contactChangeApprovals.newValue });
  if (!approved) return c.json(dead, 400);

  return c.json({ approved: true, channel, newValue: approved.newValue, expiresInMinutes: APPROVAL_MINUTES });
});
