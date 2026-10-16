import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { phoneNumber } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { and, eq, gt, sql } from 'drizzle-orm';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { users, sessions, accounts, verifications, rateLimits } from '../db/schema.js';
import { sendSignInCode } from './send-code.js';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const MAX_CODES_PER_PHONE_PER_HOUR = 5;

export const auth = betterAuth({
  appName: 'MechaniFind',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
  }),

  // Phone sign-in only. Email/password is off.
  emailAndPassword: { enabled: false },

  user: {
    additionalFields: {
      // input: false = the app can NEVER set these. Only server code can.
      role: { type: 'string', required: false, defaultValue: 'driver', input: false },
      companyId: { type: 'string', required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — drivers shouldn't have to sign in mid-breakdown
    updateAge: 60 * 60 * 24,      // refreshed once a day while in use
  },

  rateLimit: {
    enabled: true,         // on in development too, so we can test it
    storage: 'database',   // survives restarts / free-tier sleeps
    window: 60,
    max: 100,
    customRules: {
      '/phone-number/send-otp': { window: 60, max: 3 },
      '/phone-number/verify': { window: 60, max: 10 },
    },
  },

  advanced: {
    // On Render/Cloudflare the real client IP arrives in these headers.
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
  },

  trustedOrigins: [
    'mechanifind://', // the mobile app's URL scheme
    ...(env.NODE_ENV === 'development' ? ['exp://'] : []), // Expo Go during development
  ],

  hooks: {
    // Per-phone limit on top of the per-IP limit: stops someone spamming one
    // person's phone (and running up an SMS bill) from many IPs.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/phone-number/send-otp') return;
      const phone = (ctx.body as { phoneNumber?: string } | undefined)?.phoneNumber ?? '';
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(verifications)
        .where(and(eq(verifications.identifier, phone), gt(verifications.createdAt, sql`now() - interval '1 hour'`)));
      if ((row?.n ?? 0) >= MAX_CODES_PER_PHONE_PER_HOUR) {
        throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many codes requested. Try again later.' });
      }
    }),
  },

  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 5 * 60,  // codes last 5 minutes
      allowedAttempts: 3, // 3 wrong guesses and the code is dead
      phoneNumberValidator: (p) => E164.test(p),
      sendOTP: ({ phoneNumber, code }) => sendSignInCode(phoneNumber, code),
      // First successful sign-in creates the account automatically.
      signUpOnVerification: {
        getTempEmail: (p) => `${p.replace(/\D/g, '')}@phone.mechanifind.invalid`,
        getTempName: () => 'New user',
      },
    }),
    expo(),
  ],
});

export type Session = typeof auth.$Infer.Session;
