// Tests for the admin audit log. Runs the real admin tools as a separate process.
//   npm run test:audit
// Rows written here are marked source='test'. They are never deleted (the log is append-only).
import { execFileSync } from 'node:child_process';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { adminAuditLog, mechanicProfiles, users } from '../src/db/schema.js';
import { audit } from '../src/admin/audit.js';

const MECH = 't_audit_mech';
const EMAIL = 't_audit_mech@test.local';
const FAKE_EIN = '771234567';
let failed = 0;
const pass = (name: string, ok: boolean, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`);
};
const run = (script: string, args: string[]) => {
  try {
    execFileSync('npx', ['tsx', `scripts/${script}`, ...args], { env: { ...process.env, MF_AUDIT_SOURCE: 'test' }, stdio: 'pipe' });
    return 0;
  } catch (e) { return (e as { status?: number }).status ?? 1; }
};
const lastId = async () => (await db.execute(sql`select coalesce(max(id), 0)::bigint as id from admin_audit_log`)).rows[0]!.id as number;
const rowsSince = (id: number) => db.select().from(adminAuditLog).where(gt(adminAuditLog.id, Number(id))).orderBy(adminAuditLog.id);
const refused = async (q: ReturnType<typeof sql>) => { try { await db.execute(q); return false; } catch { return true; } };

async function clean() {
  await db.execute(sql`delete from mechanic_profiles where user_id = ${MECH}`);
  await db.execute(sql`delete from users where id = ${MECH}`);
}

try {
  await clean();
  await db.insert(users).values({ id: MECH, name: 'Audit Mech', email: EMAIL, role: 'mechanic' });
  await db.insert(mechanicProfiles).values({
    userId: MECH, businessName: 'Audit Diesel', serviceType: 'mobile', serviceArea: 'Elgin',
    llcNumber: 'LLC123', llcState: 'IL', ein: FAKE_EIN, insuranceProvider: 'Test Ins',
    insurancePolicyNumber: 'P-1234', insuranceCoverageDollars: 1000000, insuranceExpiresOn: '2099-01-01',
  });

  const runStart = await lastId(); // log rows are never deleted, so only count this run's
  console.log('--- Changes are logged');
  let start = await lastId();
  pass('approve runs', run('approve-mechanic.mts', [EMAIL]) === 0);
  let rows = await rowsSince(start);
  const a = rows[0];
  pass('approve writes exactly one row', rows.length === 1, `got ${rows.length}`);
  pass('...action, result, target recorded', a?.action === 'mechanic.approve' && a.outcome === 'ok' && a.targetId === MECH, JSON.stringify(a));
  pass('...who did it recorded', !!a && a.actor.includes('@') && a.source === 'test', a?.actor);
  pass('...before and after recorded', JSON.stringify((a?.details as any)?.before) === '{"isApproved":false,"isAvailable":false}'
    && JSON.stringify((a?.details as any)?.after) === '{"isApproved":true,"isAvailable":false}', JSON.stringify(a?.details));
  pass('...time comes from the database (within a minute)', !!a && Math.abs(Date.now() - a.at.getTime()) < 60_000);

  start = await lastId();
  pass('revoke runs', run('approve-mechanic.mts', [EMAIL, '--revoke']) === 0);
  rows = await rowsSince(start);
  pass('revoke logged with before/after', rows.length === 1 && rows[0]!.action === 'mechanic.revoke'
    && (rows[0]!.details as any).after.isApproved === false, JSON.stringify(rows));

  console.log('--- Refused attempts are logged');
  await db.update(mechanicProfiles).set({ insuranceExpiresOn: sql`current_date` }).where(eq(mechanicProfiles.userId, MECH));
  start = await lastId();
  pass('approving expired insurance fails', run('approve-mechanic.mts', [EMAIL]) === 1);
  rows = await rowsSince(start);
  pass('...and is logged as refused with the reason', rows.length === 1 && rows[0]!.outcome === 'refused'
    && (rows[0]!.details as any).reason === 'missing_details_or_expired_insurance', JSON.stringify(rows));
  const [still] = await db.select({ ok: mechanicProfiles.isApproved }).from(mechanicProfiles).where(eq(mechanicProfiles.userId, MECH));
  pass('...and the profile stayed unapproved', still?.ok === false);
  await db.update(mechanicProfiles).set({ insuranceExpiresOn: '2099-01-01' }).where(eq(mechanicProfiles.userId, MECH));

  start = await lastId();
  const NOBODY = 'nobody-here@test.local';
  pass('unknown account fails', run('approve-mechanic.mts', [NOBODY]) === 1);
  rows = await rowsSince(start);
  pass('...logged as refused (no_account)', rows.length === 1 && (rows[0]!.details as any).reason === 'no_account', JSON.stringify(rows));
  pass('...without storing the looked-up email', !JSON.stringify(rows).includes(NOBODY));

  console.log('--- Views are logged');
  start = await lastId();
  pass('list runs', run('approve-mechanic.mts', ['--list']) === 0);
  rows = await rowsSince(start);
  const v = rows[0];
  pass('list writes a view row', rows.length === 1 && v?.action === 'mechanic.list', JSON.stringify(rows));
  pass('...recording exactly which mechanics were shown', ((v?.details as any)?.mechanicIds ?? []).includes(MECH));
  pass('...and that the full EIN was shown', ((v?.details as any)?.fieldsShown ?? []).includes('fullEin'));
  pass('...without copying the EIN into the log', !JSON.stringify(v).includes(FAKE_EIN));

  start = await lastId();
  pass('reading the log runs', run('audit-log.mts', ['5']) === 0);
  rows = await rowsSince(start);
  pass('reading the log is logged too', rows.length === 1 && rows[0]!.action === 'audit.view', JSON.stringify(rows));

  console.log('--- The log can\'t be altered');
  const someId = Number(rows[0]!.id);
  pass('editing an entry is refused', await refused(sql`update admin_audit_log set actor = 'someone else' where id = ${someId}`));
  pass('deleting an entry is refused', await refused(sql`delete from admin_audit_log where id = ${someId}`));
  pass('wiping the table is refused', await refused(sql`truncate admin_audit_log`));
  const [kept] = await db.select().from(adminAuditLog).where(eq(adminAuditLog.id, someId));
  pass('...entry is unchanged', kept?.actor === rows[0]!.actor);

  start = await lastId();
  await db.execute(sql`insert into admin_audit_log (actor, source, action, outcome, at)
    values ('backdate-test', 'test', 'audit.view', 'ok', '2000-01-01')`);
  rows = await rowsSince(start);
  pass('backdating is impossible (database sets the time)', rows.length === 1 && rows[0]!.at.getFullYear() >= 2026, String(rows[0]?.at));

  console.log('--- Safety rules');
  start = await lastId();
  let threw = false;
  try { await audit(db, { actor: 't', actorUserId: null, source: 'test', action: 'audit.view', details: { nested: { ein: FAKE_EIN } } }); }
  catch { threw = true; }
  pass('logging a secret field is refused', threw && (await rowsSince(start)).length === 0);

  // Change + log in one transaction: if the log fails, the change is undone.
  try {
    await db.transaction(async (tx) => {
      await tx.update(mechanicProfiles).set({ isApproved: true }).where(eq(mechanicProfiles.userId, MECH));
      await audit(tx, { actor: 't', actorUserId: null, source: 'test', action: 'mechanic.approve', details: { token: 'x' } });
    });
  } catch { /* expected */ }
  const [after] = await db.select({ ok: mechanicProfiles.isApproved }).from(mechanicProfiles).where(eq(mechanicProfiles.userId, MECH));
  pass('if the log can\'t be written, the change is undone', after?.ok === false);

  await clean();
  const history = await db.select({ id: adminAuditLog.id }).from(adminAuditLog)
    .where(and(eq(adminAuditLog.targetType, 'mechanic'), eq(adminAuditLog.targetId, MECH), gt(adminAuditLog.id, Number(runStart))));
  // approve + revoke + refused approve
  pass('deleting the account keeps its history', history.length === 3, `got ${history.length}`);
} finally {
  await clean().catch(() => {});
  await pool.end();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exitCode = failed ? 1 : 0;
