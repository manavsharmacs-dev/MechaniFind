import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { phoneNumber, emailOTP, captcha } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { users, sessions, accounts, verifications, rateLimits } from '../db/schema.js';
import { sendEmailCode, sendSignInCode } from './send-code.js';
import { emailProblem, normalizeEmail, PLACEHOLDER_EMAIL_DOMAIN } from './email.js';
import { useBudget, useQuota } from '../protect/quota.js';
import { QUOTA } from '../protect/limits.js';

// US numbers only (+1, valid area code and exchange). Blocks international
// "SMS pumping" fraud, where bots trigger texts to expensive foreign numbers.
const US_PHONE = /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/;

/** The ONLY sign-in endpoints the app uses. Everything else Better Auth offers is switched off. */
export const ALLOWED_AUTH_ROUTES = new Set([
  // Phone: sign in, or (when signed in) add a phone to the account
  'POST /api/auth/phone-number/send-otp',
  'POST /api/auth/phone-number/verify',
  // Email: sign in
  'POST /api/auth/email-otp/send-verification-otp',
  'POST /api/auth/sign-in/email-otp',
  // Email: (when signed in) add/replace the account's email
  'POST /api/auth/email-otp/request-email-change',
  'POST /api/auth/email-otp/change-email',
  // Session
  'GET /api/auth/get-session',
  'POST /api/auth/sign-out',
]);

/** Header our server sets with the verified caller IP (any client-sent copy is overwritten). */
export const CLIENT_IP_HEADER = 'x-mf-client-ip';

const tooMany = () => new APIError('TOO_MANY_REQUESTS', { message: 'Too many codes requested. Try again later.' });
const tooManyTries = () => new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts. Try again later.' });
const paused = () => new APIError('SERVICE_UNAVAILABLE', { message: 'Sign-in is temporarily unavailable. Please try again later.' });

/** Quotas shared by every "send a code" route: per address, per IP, and the app-wide daily budget. */
async function guardCodeSend(kind: 'sms' | 'email', address: string, ip: string) {
  const perHour = kind === 'sms' ? QUOTA.smsPerPhonePerHour : QUOTA.emailPerAddressPerHour;
  const perDay = kind === 'sms' ? QUOTA.smsPerPhonePerDay : QUOTA.emailPerAddressPerDay;
  const hour = await useQuota(kind, `${kind}:${address}`, perHour, 'hour');
  const day = hour.ok ? await useQuota(`${kind}_day`, `${kind}:${address}`, perDay, 'day') : hour;
  if (!hour.ok || !day.ok) throw tooMany();
  // One IP can't request more than N codes an hour across phone AND email combined.
  const perIp = await useQuota('code_ip', `ip:${ip}`, QUOTA.codesPerIpPerHour, 'hour');
  if (!perIp.ok) throw tooMany();
  const budget = await useBudget(kind === 'sms' ? 'smsPerDay' : 'emailPerDay');
  if (!budget.ok) throw paused();
}

function checkEmail(raw: unknown): string {
  const email = normalizeEmail(raw);
  const problem = emailProblem(email);
  if (problem === 'disposable') {
    throw new APIError('BAD_REQUEST', { message: 'Please use a permanent email address.', code: 'DISPOSABLE_EMAIL' });
  }
  if (problem) throw new APIError('BAD_REQUEST', { message: 'Invalid email address', code: 'INVALID_EMAIL' });
  return email;
}

export const auth = betterAuth({
  appName: 'MechaniFind',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
  }),

  // One-time codes by phone or email only. No passwords anywhere.
  emailAndPassword: { enabled: false },

  // Belt and braces: even if a route slipped past the allowlist in index.ts,
  // these can never run. (Password reset here would allow silent account takeover.)
  disabledPaths: [
    '/phone-number/request-password-reset', '/phone-number/reset-password', '/sign-in/phone-number',
    '/email-otp/request-password-reset', '/email-otp/reset-password', '/forget-password/email-otp',
    '/email-otp/check-verification-otp', '/email-otp/verify-email',
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
      // Set when an account is deleted or banned. Checked on every signed-in request.
      deletedAt: { type: 'date', required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — drivers shouldn't have to sign in mid-breakdown
    updateAge: 60 * 60 * 24,      // refreshed once a day while in use
    // Adding an email/phone already requires a code sent to it, so there's no
    // need to force a fresh sign-in first.
    freshAge: 0,
  },

  rateLimit: {
    enabled: true,         // on in development too, so we can test it
    storage: 'memory',     // our own DB-backed quotas cover the expensive cases
    window: 60,
    max: 100,
    customRules: {
      '/phone-number/send-otp': { window: 60, max: 3 },
      '/phone-number/verify': { window: 60, max: 10 },
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/email-otp/request-email-change': { window: 60, max: 3 },
      '/sign-in/email-otp': { window: 60, max: 10 },
      '/email-otp/change-email': { window: 60, max: 10 },
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
    // Runs after the CAPTCHA and IP rate limit pass, before any code is created or checked.
    before: createAuthMiddleware(async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const ip = ctx.request?.headers.get(CLIENT_IP_HEADER) ?? 'unknown';

      switch (ctx.path) {
        // ----- Code guessing: at most N attempts per phone/email per hour, across all codes and IPs -----
        case '/phone-number/verify': {
          const tries = await useQuota('verify', `phone:${String(body.phoneNumber ?? '')}`, QUOTA.verifyAttemptsPerPhonePerHour, 'hour');
          if (!tries.ok) throw tooManyTries();
          return;
        }
        case '/sign-in/email-otp':
        case '/email-otp/change-email': {
          const email = normalizeEmail(ctx.path === '/sign-in/email-otp' ? body.email : body.newEmail);
          const tries = await useQuota('verify_email', `email:${email}`, QUOTA.verifyAttemptsPerEmailPerHour, 'hour');
          if (!tries.ok) throw tooManyTries();
          return;
        }

        // ----- Sending codes -----
        case '/phone-number/send-otp': {
          const phone = String(body.phoneNumber ?? '');
          // Reject junk before it can use up anyone's quota.
          if (!US_PHONE.test(phone)) throw new APIError('BAD_REQUEST', { message: 'Invalid phone number', code: 'INVALID_PHONE_NUMBER' });
          return guardCodeSend('sms', phone, ip);
        }
        case '/email-otp/send-verification-otp': {
          // Only sign-in codes. Password-reset and other code types don't exist here.
          if (body.type !== 'sign-in') throw new APIError('BAD_REQUEST', { message: 'Unsupported request' });
          return guardCodeSend('email', checkEmail(body.email), ip);
        }
        case '/email-otp/request-email-change':
          return guardCodeSend('email', checkEmail(body.newEmail), ip);
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
        getTempEmail: () => `${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`,
        getTempName: () => 'New user',
      },
    }),
    emailOTP({
      otpLength: 6,
      expiresIn: 5 * 60,
      allowedAttempts: 3,
      storeOTP: 'hashed',   // codes are never stored readable in the database
      // First successful email sign-in creates the account automatically.
      disableSignUp: false,
      // Signed-in users can attach a real email (proven by a code sent to it).
      changeEmail: { enabled: true, verifyCurrentEmail: false },
      sendVerificationOTP: ({ email, otp }) => sendEmailCode(email, otp),
    }),
    expo(),
    // CAPTCHA on code requests, so bots can't trigger texts/emails. On whenever a key
    // is set; required in production (enforced in env.ts).
    ...(env.TURNSTILE_SECRET_KEY
      ? [captcha({
          provider: 'cloudflare-turnstile',
          secretKey: env.TURNSTILE_SECRET_KEY,
          endpoints: ['/phone-number/send-otp', '/email-otp/send-verification-otp', '/email-otp/request-email-change'],
        })]
      : []),
  ],
});

export type Session = typeof auth.$Infer.Session;
