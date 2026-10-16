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
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
