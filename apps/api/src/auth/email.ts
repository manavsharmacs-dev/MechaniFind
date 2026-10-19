import { createRequire } from 'node:module';
import { z } from 'zod';

// ~120k known throwaway-inbox domains (mailinator, 10minutemail, ...), MIT licensed.
const require = createRequire(import.meta.url);
const DISPOSABLE = new Set<string>(require('disposable-email-domains') as string[]);

/** Phone-only accounts get a random placeholder email on this domain. It's never real. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'phone.mechanifind.invalid';

const emailSchema = z.email().max(254);

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Why an email can't be used, or null if it's fine. */
export function emailProblem(email: string): 'invalid' | 'disposable' | null {
  if (!emailSchema.safeParse(email).success) return 'invalid';
  const domain = email.split('@')[1] ?? '';
  if (domain === PLACEHOLDER_EMAIL_DOMAIN || domain.endsWith('.invalid')) return 'invalid';
  if (DISPOSABLE.has(domain)) return 'disposable';
  return null;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
