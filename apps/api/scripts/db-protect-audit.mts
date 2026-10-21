// Makes admin_audit_log append-only, enforced by the database itself:
//   - INSERT: `at` is always set to the database clock (no backdating)
//   - UPDATE / DELETE / TRUNCATE: refused
// Safe to run again. Run after creating the table:  npm run db:protect-audit
//
// Limit: the database OWNER account can still drop these triggers. Making the
// log fully tamper-proof needs the app to use a separate, less-privileged
// database role (one of the deferred security items).
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';

const statements = [
  `create or replace function admin_audit_log_guard() returns trigger language plpgsql as $fn$
   begin
     if tg_op = 'INSERT' then
       new.at := now();  -- database clock, whatever the caller sent
       return new;
     end if;
     raise exception 'admin_audit_log is append-only: % refused', tg_op;
   end
   $fn$`,
  `drop trigger if exists admin_audit_log_stamp on admin_audit_log`,
  `create trigger admin_audit_log_stamp before insert on admin_audit_log
     for each row execute function admin_audit_log_guard()`,
  `drop trigger if exists admin_audit_log_no_change on admin_audit_log`,
  `create trigger admin_audit_log_no_change before update or delete on admin_audit_log
     for each row execute function admin_audit_log_guard()`,
  `drop trigger if exists admin_audit_log_no_truncate on admin_audit_log`,
  `create trigger admin_audit_log_no_truncate before truncate on admin_audit_log
     for each statement execute function admin_audit_log_guard()`,
];

try {
  await db.transaction(async (tx) => {
    for (const s of statements) await tx.execute(sql.raw(s));
  });
  const r = await db.execute(sql`select tgname from pg_trigger
    where tgrelid = 'admin_audit_log'::regclass and not tgisinternal order by 1`);
  console.log('audit log protected by:', r.rows.map((x) => x.tgname).join(', '));
} catch (e) {
  console.error(String((e as Error).message));
  process.exitCode = 1;
} finally {
  await pool.end();
}
