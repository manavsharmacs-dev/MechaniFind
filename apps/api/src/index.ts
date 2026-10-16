import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { env } from './env.js';
import { db } from './db/index.js';
import { auth } from './auth/auth.js';
import { requireAuth, type AuthVars } from './auth/middleware.js';

const app = new Hono<AuthVars>();

app.use('*', secureHeaders());

// Never send internal error details (stack traces, SQL) to the client.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.get('/', (c) => c.text('MechaniFind API is running'));

// Confirms the database is reachable without revealing anything about it.
app.get('/health/db', async (c) => {
  await db.execute(sql`select 1`);
  return c.json({ ok: true });
});

// ---------- Sign-in (handled by Better Auth) ----------
// POST /api/auth/phone-number/send-otp   { phoneNumber }
// POST /api/auth/phone-number/verify     { phoneNumber, code }
// GET  /api/auth/get-session
// POST /api/auth/sign-out
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// ---------- Signed-in routes ----------
app.get('/me', requireAuth, (c) => {
  const u = c.get('user');
  // Return only what the app needs — never the whole row.
  return c.json({
    id: u.id,
    name: u.name,
    phoneNumber: u.phoneNumber,
    role: u.role,
    companyId: u.companyId ?? null,
  });
});

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`API running on http://${info.address}:${info.port}`);
});
