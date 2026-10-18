import { createMiddleware } from 'hono/factory';
import { auth, type Session } from './auth.js';
import { checkUserRate, tooMany } from '../protect/middleware.js';

type Role = 'driver' | 'mechanic' | 'fleet_manager' | 'admin';

export type AuthVars = {
  Variables: {
    user: Session['user'];
    session: Session['session'];
  };
};

/** Rejects the request unless the caller is signed in. Use on every private route. */
export const requireAuth = createMiddleware<AuthVars>(async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return c.json({ error: 'unauthorized' }, 401);
  // Per-account limit: one account can't flood us by spreading across devices/IPs.
  const rate = checkUserRate(result.user.id);
  if (!rate.ok) return tooMany(c, rate.retryAfterSec);
  c.set('user', result.user);
  c.set('session', result.session);
  await next();
});

/** Use after requireAuth: only lets the listed roles through. */
export const requireRole = (...roles: Role[]) =>
  createMiddleware<AuthVars>(async (c, next) => {
    if (!roles.includes(c.get('user').role as Role)) return c.json({ error: 'forbidden' }, 403);
    await next();
  });
