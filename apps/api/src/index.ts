import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { timeout } from 'hono/timeout';
import { HTTPException } from 'hono/http-exception';
import { sql } from 'drizzle-orm';
import { env } from './env.js';
import { db } from './db/index.js';
import { auth, ALLOWED_AUTH_ROUTES, CLIENT_IP_HEADER } from './auth/auth.js';
import { requireAuth, type AuthVars } from './auth/middleware.js';
import { isPlaceholderEmail } from './auth/email.js';
import { protect, tooMany } from './protect/middleware.js';
import { MemoryLimiter } from './protect/memory-limiter.js';
import { clientIp } from './protect/client-ip.js';
import { RATE, REQUEST } from './protect/limits.js';
import { startCleanupJob } from './protect/cleanup.js';

const app = new Hono<AuthVars>();

// ---------- Protection layer: runs on EVERY request, even to routes that don't exist ----------
app.use('*', protect);   // per-IP rate limit, in-progress cap, scanner auto-block
app.use('*', secureHeaders());
app.use('*', bodyLimit({
  maxSize: REQUEST.maxBodyBytes,
  onError: (c) => c.json({ error: 'payload_too_large' }, 413),
}));
app.use('*', timeout(REQUEST.timeoutMs));

// Never send internal error details (stack traces, SQL) to the client.
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: 'request_failed' }, err.status);
  // Database errors can include query values (phone numbers etc.), so in
  // production only the error type is logged.
  if (env.NODE_ENV === 'production') console.error(`[error] ${err.name} on ${c.req.method} ${c.req.path}`);
  else console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.get('/', (c) => c.text('MechaniFind API is running'));

// Confirms the database is reachable without revealing anything about it.
// Tightly limited: each call wakes the (free-tier) database.
const healthLimiter = new MemoryLimiter();
app.get('/health/db', async (c) => {
  const r = healthLimiter.hit(clientIp(c), RATE.healthPerMinute, 60_000);
  if (!r.ok) return tooMany(c, r.retryAfterSec);
  await db.execute(sql`select 1`);
  return c.json({ ok: true });
});

// ---------- Sign-in (handled by Better Auth) ----------
// POST /api/auth/phone-number/send-otp          { phoneNumber }        (+ CAPTCHA token in production)
// POST /api/auth/phone-number/verify            { phoneNumber, code [, updatePhoneNumber] }
// POST /api/auth/email-otp/send-verification-otp { email, type: "sign-in" } (+ CAPTCHA)
// POST /api/auth/sign-in/email-otp              { email, otp }
// POST /api/auth/email-otp/request-email-change { newEmail }   (signed in)
// POST /api/auth/email-otp/change-email         { newEmail, otp } (signed in)
// GET  /api/auth/get-session
// POST /api/auth/sign-out
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  // Only the 4 sign-in routes the app uses exist. Everything else → 404.
  if (!ALLOWED_AUTH_ROUTES.has(`${c.req.method} ${c.req.path}`)) return c.notFound();
  // Hand Better Auth the IP WE verified, overwriting anything the caller sent.
  const headers = new Headers(c.req.raw.headers);
  headers.set(CLIENT_IP_HEADER, clientIp(c));
  return auth.handler(new Request(c.req.raw, { headers }));
});

// ---------- Signed-in routes ----------
app.get('/me', requireAuth, (c) => {
  const u = c.get('user');
  // Return only what the app needs — never the whole row.
  return c.json({
    id: u.id,
    name: u.name,
    phoneNumber: u.phoneNumber ?? null,
    phoneVerified: !!u.phoneNumberVerified,
    // Phone-only accounts have an internal placeholder email — never show it.
    email: isPlaceholderEmail(u.email) ? null : u.email,
    emailVerified: !isPlaceholderEmail(u.email) && !!u.emailVerified,
    role: u.role,
    companyId: u.companyId ?? null,
  });
});

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`API running on http://${info.address}:${info.port}`);
}) as Server;

// Drop clients that send requests painfully slowly to tie up the server.
server.headersTimeout = REQUEST.headersTimeoutMs;
server.requestTimeout = REQUEST.timeoutMs + 5_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

startCleanupJob();
