// Admin audit log: one row every time an admin views or changes something.
//
// Rules for callers:
//  - CHANGES: call audit() with the same `tx` as the change, inside one transaction,
//    so the change and its log row are saved together or not at all.
//  - VIEWS: await audit() BEFORE showing anything. If logging fails, show nothing.
//  - REFUSALS: log them too (outcome 'refused') — attempts matter.
//  - Never log secrets. Record ids and field names, not values like the full EIN.
import os from 'node:os';
import { db } from '../db/index.js';
import { adminAuditLog, type AUDIT_OUTCOMES, type AUDIT_SOURCES } from '../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

/** Every action the log knows about. Add new ones here so typos can't slip in. */
export type AuditAction =
  | 'mechanic.list'     // viewed mechanic profiles (includes business + insurance details)
  | 'mechanic.approve'  // approved a mechanic
  | 'mechanic.revoke'   // revoked a mechanic's approval
  | 'user.set_contact'  // support replaced a user's email/phone (they lost access to the old one)
  | 'audit.view';       // read this log

export type AuditActor = {
  actor: string;                // readable "who"
  actorUserId: string | null;   // admin's account id, once there's a signed-in admin panel
  source: (typeof AUDIT_SOURCES)[number];
};

export type AuditEntry = AuditActor & {
  action: AuditAction;
  outcome?: (typeof AUDIT_OUTCOMES)[number];
  targetType?: 'mechanic' | 'audit_log' | 'user';
  targetId?: string | null;
  details?: Record<string, unknown>;
};

// Keys that must never appear in a log row, at any depth.
// Raw contact keys are refused too: log masked values under names like "oldMasked" instead,
// so the log (which can never be deleted) doesn't become a list of everyone's email and phone.
const FORBIDDEN_KEYS = new Set([
  'ein', 'password', 'token', 'secret', 'otp', 'code', 'cookie',
  'email', 'phone', 'phonenumber', 'newvalue', 'oldvalue',
]);

function assertNoSecrets(value: unknown, path = 'details'): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) throw new Error(`audit: refusing to log secret field ${path}.${k}`);
      assertNoSecrets(v, `${path}.${k}`);
    }
  }
}

/** Writes one log row. Throws if it can't — callers must then not proceed. */
export async function audit(exec: Executor, e: AuditEntry): Promise<void> {
  const details = e.details ?? {};
  assertNoSecrets(details);
  await exec.insert(adminAuditLog).values({
    actor: e.actor.slice(0, 200),
    actorUserId: e.actorUserId,
    source: e.source,
    action: e.action,
    outcome: e.outcome ?? 'ok',
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    details,
    // `at` is stamped by the database trigger.
  });
}

/**
 * Who is running a command-line admin tool: the computer account and machine name.
 * The test suites set MF_AUDIT_SOURCE=test so their rows can be filtered out (never deleted).
 */
export function cliActor(): AuditActor {
  let who = 'unknown';
  try { who = `${os.userInfo().username}@${os.hostname()}`; } catch { /* keep 'unknown' */ }
  return { actor: who, actorUserId: null, source: process.env.MF_AUDIT_SOURCE === 'test' ? 'test' : 'cli' };
}
