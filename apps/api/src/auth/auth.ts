import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { phoneNumber, captcha } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { users, sessions, accounts, verifications, rateLimits } from '../db/schema.js';
import { sendSignInCode } from './send-code.js';
import { useBudget, useQuota } from '../protect/quota.js';
import { QUOTA } from '../protect/limits.js';

// US numbers only (+1, valid area code and exchange). Blocks international
// "SMS pumping" fraud, where bots trigger texts to expensive foreign numbers.
const US_PHONE = /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/;

/** The ONLY sign-in endpoints the app uses. Everything else Better Auth offers is switched off. */
export const ALLOWED_AUTH_ROUTES = new Set([
  'POST /api/auth/phone-number/send-otp',
  'POST /api/auth/phone-number/verify',
  'GET /api/auth/get-session',
  'POST /api/auth/sign-out',
]);

/** Header our server sets with the verified caller IP (any client-sent copy is overwritten). */
export const CLIENT_IP_HEADER = 'x-mf-client-ip';

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

  // Belt and braces: even if a route slipped past the allowlist in index.ts,
  // these can never run. (Password reset here would allow silent account takeover.)
  disabledPaths: [
    '/phone-number/request-password-reset', '/phone-number/reset-password', '/sign-in/phone-number',
    '/update-user', '/delete-user', '/change-email', '/change-password', '/set-password', '/verify-password',
    '/list-accounts', '/unlink-account', '/account-info', '/get-access-token', '/refresh-token',
    '/update-session', '/list-sessions', '/revoke-session', '/revoke-sessions', '/revoke-other-sessions',
    '/expo-authorization-proxy', '/verify-email', '/send-verification-email',
    '/request-password-reset', '/reset-password', '/sign-in/social', '/link-social',
  ],

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
    storage: 'memory',     // our own DB-backed quotas cover the expensive cases
    window: 60,
    max: 100,
    customRules: {
      '/phone-number/send-otp': { window: 60, max: 3 },
      '/phone-number/verify': { window: 60, max: 10 },
      '/get-session': { window: 60, max: 60 },
    },
  },

  advanced: {
    // Only trust the IP our own server worked out (see src/protect/client-ip.ts).
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },

  trustedOrigins: [
    'mechanifind://', // the mobile app's URL scheme
    ...(env.NODE_ENV === 'development' ? ['exp://'] : []), // Expo Go during development
  ],

  hooks: {
    // Runs after the CAPTCHA and IP rate limit pass, before a code is created.
    before: createAuthMiddleware(async (ctx) => {
      const phone = (ctx.body as { phoneNumber?: string } | undefined)?.phoneNumber ?? '';

      // Code guessing: at most N attempts per phone per hour, no matter how many codes or IPs.
      if (ctx.path === '/phone-number/verify') {
        const tries = await useQuota('verify', `phone:${phone}`, QUOTA.verifyAttemptsPerPhonePerHour, 'hour');
        if (!tries.ok) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts. Try again later.' });
        return;
      }

      if (ctx.path !== '/phone-number/send-otp') return;
      // Reject junk before it can use up anyone's quota.
      if (!US_PHONE.test(phone)) throw new APIError('BAD_REQUEST', { message: 'Invalid phone number', code: 'INVALID_PHONE_NUMBER' });

      // Per phone: stops someone spamming one person's phone from many IPs.
      const hour = await useQuota('sms', `phone:${phone}`, QUOTA.smsPerPhonePerHour, 'hour');
      const day = hour.ok ? await useQuota('sms_day', `phone:${phone}`, QUOTA.smsPerPhonePerDay, 'day') : hour;
      if (!hour.ok || !day.ok) {
        throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many codes requested. Try again later.' });
      }

      // Per IP (hourly), on top of Better Auth's per-minute limit.
      const ip = ctx.request?.headers.get(CLIENT_IP_HEADER) ?? 'unknown';
      const perIp = await useQuota('sms_ip', `ip:${ip}`, QUOTA.smsPerIpPerHour, 'hour');
      if (!perIp.ok) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many codes requested. Try again later.' });

      // Whole app: daily SMS spending cap.
      const budget = await useBudget('smsPerDay');
      if (!budget.ok) {
        throw new APIError('SERVICE_UNAVAILABLE', { message: 'Sign-in is temporarily unavailable. Please try again later.' });
      }
    }),
  },

  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 5 * 60,  // codes last 5 minutes
      allowedAttempts: 3, // 3 wrong guesses and the code is dead
      phoneNumberValidator: (p) => US_PHONE.test(p),
      sendOTP: ({ phoneNumber, code }) => sendSignInCode(phoneNumber, code),
      // First successful sign-in creates the account automatically.
      signUpOnVerification: {
        // Random, so a recycled phone number can never collide with an old account.
        getTempEmail: () => `${randomUUID()}@phone.mechanifind.invalid`,
        getTempName: () => 'New user',
      },
    }),
    expo(),
    // CAPTCHA on code requests, so bots can't trigger texts. On whenever a key is
    // set; required in production (enforced in env.ts).
    ...(env.TURNSTILE_SECRET_KEY
      ? [captcha({ provider: 'cloudflare-turnstile', secretKey: env.TURNSTILE_SECRET_KEY, endpoints: ['/phone-number/send-otp'] })]
      : []),
  ],
});

export type Session = typeof auth.$Infer.Session;
