import 'dotenv/config';
import { z } from 'zod';

// Checked once at startup: the app refuses to run with missing/invalid settings.
const schema = z.object({
  DATABASE_URL: z.string().startsWith('postgres', 'DATABASE_URL must be a Postgres connection string'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  // 127.0.0.1 = only reachable from your own computer. Set HOST=0.0.0.0 on the hosting provider.
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Required: forgetting it in production must NOT silently mean "development".
  NODE_ENV: z.enum(['development', 'production', 'test']),
  // Development only: print sign-in codes in the terminal instead of texting them.
  DEV_PRINT_OTP: z.enum(['0', '1']).default('0'),

  // --- Abuse protection (all optional; safe defaults live in src/protect/limits.ts) ---
  // Header the hosting proxy sets with the real visitor IP, e.g. "cf-connecting-ip"
  // (Cloudflare) or "x-forwarded-for" (Render). Leave unset when nothing sits in front.
  TRUST_PROXY_HEADER: z.string().toLowerCase().optional(),
  // Cloudflare Turnstile CAPTCHA secret. Required in production.
  TURNSTILE_SECRET_KEY: z.string().optional(),
  SMS_DAILY_CAP: z.coerce.number().int().min(0).optional(),
  EMAIL_DAILY_CAP: z.coerce.number().int().min(0).optional(),
  LLM_DAILY_CAP: z.coerce.number().int().min(0).optional(),
  RATE_IP_PER_MIN: z.coerce.number().int().min(1).optional(),
  RATE_USER_PER_MIN: z.coerce.number().int().min(1).optional(),
  SCANNER_BAD_LIMIT: z.coerce.number().int().min(1).optional(),
  LOCATION_PING_SECONDS: z.coerce.number().int().min(1).optional(), // tests only
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.DEV_PRINT_OTP === '1') {
  console.error('DEV_PRINT_OTP must not be enabled in production.');
  process.exit(1);
}
if (parsed.data.NODE_ENV === 'production' && !parsed.data.TURNSTILE_SECRET_KEY) {
  console.error('TURNSTILE_SECRET_KEY is required in production (CAPTCHA on sign-in).');
  process.exit(1);
}

export const env = parsed.data;
