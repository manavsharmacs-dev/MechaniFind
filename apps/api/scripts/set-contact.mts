// Support tool (fix B4): replace a user's email or phone when they've lost access to the old one.
//   npm run user:set-contact -- <old email/phone the caller gives you> --email new@example.com
//   npm run user:set-contact -- <old email/phone the caller gives you> --phone +18155550123
//
// Identity is checked BY THE COMMAND, not by eye: you type what the caller tells you, and it compares
// against the database, showing only "matches" / "doesn't match". Private details never print.
// At least 2 checks must pass; for mechanic accounts one of them must be business/insurance.
// Every refusal is written to admin_audit_log (masked values only — never full emails/phones).
import { createInterface } from 'node:readline/promises';
import { and, eq, gt, ne, sql, type AnyColumn } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { adminAuditLog, jobs, mechanicProfiles, serviceRequests, users } from '../src/db/schema.js';
import { audit, cliActor } from '../src/admin/audit.js';
import { US_PHONE } from '../src/auth/auth.js';
import { emailProblem, isPlaceholderEmail, normalizeEmail } from '../src/auth/email.js';
import { cleanText } from '../src/lib/validate.js';
import { maskEmail, maskPhone } from '../src/routes/account.js';

const MIN_CHECKS = 2;
const MAX_FAILED_ROUNDS_PER_DAY = 3; // stops someone calling support again and again to guess answers
const noteSchema = cleanText(15, 300);

type Channel = 'email' | 'phone';
const actor = cliActor();
const mask = (ch: Channel, v: string) => (ch === 'email' ? maskEmail(v) : maskPhone(v));

/** Stops the command after logging why. */
class Refused extends Error {}
async function refuse(reason: string, message: string, targetId: string | null, details: Record<string, unknown>): Promise<never> {
  await audit(db, { ...actor, action: 'user.set_contact', outcome: 'refused', targetType: 'user', targetId,
    details: { reason, ...details } });
  throw new Refused(message);
}

// Comparisons ignore case and extra spaces. Empty never matches anything.
const tidy = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const sameName = (said: string, stored: string) => tidy(said) !== '' && tidy(said) === tidy(stored);
const compact = (s: string) => s.toUpperCase().replace(/[\s\-.]/g, '');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q: string) => (await rl.question(q)).trim();
const yes = async (q: string) => /^y(es)?$/i.test(await ask(`${q} (y/N) `));

try {
  // ---- 1. Arguments ----
  const [oldRaw, flag, newRaw, ...extra] = process.argv.slice(2);
  if (!oldRaw || (flag !== '--email' && flag !== '--phone') || !newRaw || extra.length) {
    throw new Refused('Usage: npm run user:set-contact -- <old email/phone> --email <new> | --phone <new>');
  }
  const channel: Channel = flag === '--email' ? 'email' : 'phone';

  // ---- 2. Find the account by the OLD contact the caller named (counts toward check #1) ----
  const oldIsEmail = oldRaw.includes('@');
  const oldValue = oldIsEmail ? normalizeEmail(oldRaw) : oldRaw.trim();
  const [found] = await db.select({
    id: users.id, name: users.name, role: users.role, deletedAt: users.deletedAt,
    email: users.email, phone: users.phoneNumber, phoneVerified: users.phoneNumberVerified,
  }).from(users).where(oldIsEmail
    ? eq(users.email, oldValue)
    : and(eq(users.phoneNumber, oldValue), eq(users.phoneNumberVerified, true)));

  if (!found || (oldIsEmail && isPlaceholderEmail(found.email))) {
    await refuse('no_account', 'No account uses that email/phone. Ask the caller to double-check it.', null,
      { channel, lookedUpBy: oldIsEmail ? 'email' : 'phone' });
  }
  const u = found!;
  if (u.deletedAt) await refuse('account_deleted', 'That account is deleted or banned. Not changing it.', u.id, { channel });

  // Too many failed rounds on this account today → stop before asking anything.
  const [{ failed }] = await db.select({ failed: sql<number>`count(*)::int` }).from(adminAuditLog).where(and(
    eq(adminAuditLog.action, 'user.set_contact'), eq(adminAuditLog.outcome, 'refused'), eq(adminAuditLog.targetId, u.id),
    sql`${adminAuditLog.details}->>'reason' = 'not_enough_checks'`, gt(adminAuditLog.at, sql`now() - interval '24 hours'`)));
  if (failed >= MAX_FAILED_ROUNDS_PER_DAY) {
    await refuse('too_many_failed_rounds', 'Too many failed verification attempts on this account in 24 hours. Escalate; do not retry today.', u.id, { channel, failed });
  }

  // What's on the account now for this channel (support only REPLACES; adding is done in the app).
  const current = channel === 'email'
    ? (isPlaceholderEmail(u.email) ? null : u.email)
    : (u.phone && u.phoneVerified ? u.phone : null);
  if (!current) {
    await refuse('nothing_to_replace', `The account has no ${channel} yet. They can add one in the app after signing in.`, u.id, { channel });
  }

  // ---- 3. The new value ----
  let newValue: string;
  if (channel === 'email') {
    newValue = normalizeEmail(newRaw);
    const problem = emailProblem(newValue);
    if (problem) await refuse('invalid_new_value', `New email is ${problem === 'disposable' ? 'a throwaway address' : 'not valid'}.`, u.id, { channel });
  } else {
    newValue = newRaw.trim();
    if (!US_PHONE.test(newValue)) await refuse('invalid_new_value', 'New phone must be a US number like +18155550123.', u.id, { channel });
  }
  if (newValue === current) await refuse('same_as_current', "That is already the account's current value.", u.id, { channel });

  // Support may learn this (and it's logged); the public app never reveals it.
  const [taken] = await db.select({ id: users.id }).from(users)
    .where(and(ne(users.id, u.id), channel === 'email' ? eq(users.email, newValue) : eq(users.phoneNumber, newValue)));
  if (taken) await refuse('new_value_taken', `That ${channel} belongs to another account.`, u.id, { channel, newMasked: mask(channel, newValue) });

  console.log(`\nAccount found (${u.role}). Replacing ${channel} ${mask(channel, current!)} -> ${mask(channel, newValue)}.`);
  console.log("Ask the caller each question. Type exactly what THEY say. Don't read anything out to them.\n");

  // ---- 4. Identity checks ----
  const checks: Record<string, boolean | 'skipped' | 'n/a'> = {};

  // Check: old contact (matched by the lookup above) + the name on the account.
  checks.nameAndOldContact = sameName(await ask('Full name on the account: '), u.name);

  // Check (mechanics only): EIN last 4, or insurance policy number.
  const isMechanic = u.role === 'mechanic';
  if (isMechanic) {
    const [p] = await db.select({ ein: mechanicProfiles.ein, policy: mechanicProfiles.insurancePolicyNumber })
      .from(mechanicProfiles).where(eq(mechanicProfiles.userId, u.id));
    const ein4 = await ask('Last 4 of their EIN (blank to skip): ');
    const policy = ein4 ? '' : await ask('Insurance policy number instead (blank to skip): ');
    if (!ein4 && !policy) checks.businessOrInsurance = 'skipped';
    else if (ein4) checks.businessOrInsurance = /^\d{4}$/.test(ein4) && !!p?.ein && p.ein.slice(-4) === ein4;
    else checks.businessOrInsurance = compact(policy).length >= 4 && !!p?.policy && compact(policy) === compact(p.policy);
  } else {
    checks.businessOrInsurance = 'n/a';
  }

  // Check: date of a breakdown (drivers) or job (mechanics) from the day before to the day after.
  const dateRaw = await ask('Date of a recent breakdown or job, YYYY-MM-DD (blank to skip): ');
  if (!dateRaw) checks.recentActivity = 'skipped';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(Date.parse(dateRaw))) checks.recentActivity = false;
  else {
    const near = (col: AnyColumn) =>
      sql`${col} >= ${dateRaw}::date - interval '1 day' and ${col} < ${dateRaw}::date + interval '2 days'`;
    const asDriver = await db.select({ id: serviceRequests.id }).from(serviceRequests)
      .where(and(eq(serviceRequests.driverId, u.id), near(serviceRequests.createdAt))).limit(1);
    const asMechanic = asDriver.length ? [] : await db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.mechanicId, u.id), near(jobs.acceptedAt))).limit(1);
    checks.recentActivity = asDriver.length > 0 || asMechanic.length > 0;
  }

  // Check: photo ID (can't be automated, so you confirm it). Never save the ID.
  checks.photoId = await yes('Did you see a government photo ID matching the account name on a video call? Do NOT save it.');

  // ---- 5. Score ----
  const passed = Object.entries(checks).filter(([, v]) => v === true).map(([k]) => k);
  for (const [k, v] of Object.entries(checks)) {
    if (v !== 'n/a') console.log(`  ${k}: ${v === true ? 'matches' : v === 'skipped' ? 'skipped' : 'does not match'}`);
  }
  if (passed.length < MIN_CHECKS || (isMechanic && checks.businessOrInsurance !== true)) {
    await refuse('not_enough_checks',
      isMechanic && checks.businessOrInsurance !== true
        ? 'Mechanic accounts need a matching EIN last 4 or policy number, plus one other check. Nothing changed.'
        : `Need at least ${MIN_CHECKS} matching checks. Nothing changed.`,
      u.id, { channel, checks, newMasked: mask(channel, newValue) });
  }

  // ---- 6. Your note (goes in the audit log). No contact details or ID numbers in it. ----
  const note = noteSchema.safeParse(await ask('\nShort note on how you verified them (15-300 characters, no contact info or ID numbers):\n> '));
  if (!note.success) await refuse('no_note', 'A note of 15-300 characters is required. Nothing changed.', u.id, { channel, checks });

  console.log(`\nIdentity checks passed (${passed.join(', ')}).`);
  // NEXT (B4.3): send a code to the NEW contact and have the caller read it back.
  // THEN (B4.4): one transaction: change the contact, sign out every device, clear pending approvals, log it.
  console.log('Not finished yet: nothing was changed.');
} catch (e) {
  console.error(e instanceof Refused ? e.message : `Failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  await pool.end();
}
