import { env } from '../env.js';

/**
 * Delivers a sign-in code.
 *
 * Development: prints the code in the API terminal (free).
 * Production: plug in an SMS provider here (e.g. Twilio) before launch.
 */
export async function sendSignInCode(phoneNumber: string, code: string): Promise<void> {
  if (env.NODE_ENV !== 'production') {
    console.log(`\n  [DEV] Sign-in code for ${phoneNumber}: ${code}\n`);
    return;
  }
  throw new Error('No SMS provider configured — add one in src/auth/send-code.ts');
}
