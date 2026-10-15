import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { env } from './env.js';
import { db } from './db/index.js';

const app = new Hono();

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

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`API running on http://${info.address}:${info.port}`);
});
