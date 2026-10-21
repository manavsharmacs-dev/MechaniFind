// Read the admin audit log (newest first). Reading it is logged too.
//   npm run admin:log                 last 50 entries
//   npm run admin:log -- 200          last 200 (max 1000)
//   npm run admin:log -- --all        include entries made by the test suites
import { desc, ne } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { adminAuditLog } from '../src/db/schema.js';
import { audit, cliActor } from '../src/admin/audit.js';

const args = process.argv.slice(2);
const includeTests = args.includes('--all');
const num = args.find((a) => /^\d+$/.test(a));
const limit = Math.min(Math.max(Number(num ?? 50), 1), 1000);

try {
  const unknown = args.filter((a) => a !== '--all' && a !== num);
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}. Use a number and/or --all.`);

  // Log BEFORE showing anything.
  await audit(db, { ...cliActor(), action: 'audit.view', targetType: 'audit_log', details: { limit, includeTests } });

  const rows = await db.select().from(adminAuditLog)
    .where(includeTests ? undefined : ne(adminAuditLog.source, 'test'))
    .orderBy(desc(adminAuditLog.id))
    .limit(limit);

  console.table(rows.map((r) => ({
    when: r.at.toLocaleString(),
    who: r.actor,
    via: r.source,
    action: r.action,
    result: r.outcome,
    target: r.targetId ?? '',
    details: JSON.stringify(r.details).slice(0, 120),
  })));
} catch (e) {
  console.error(String((e as Error).message));
  process.exitCode = 1;
} finally {
  await pool.end();
}
