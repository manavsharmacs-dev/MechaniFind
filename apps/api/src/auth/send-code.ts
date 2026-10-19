import { env } from '../env.js';

/**
 * Delivers a sign-in code.
 *
 * Development: prints the code in the API terminal (free).
 * Production: plug in an SMS provider here (e.g. Twilio) before launch.
 */
export async function sendSignInCode(phoneNumber: string, code: string): Promise<void> {
  if (env.NODE_ENV === 'development' && env.DEV_PRINT_OTP === '1') {
    console.log(`\n  [DEV] Sign-in code for ${phoneNumber}: ${code}\n`);
    return;
  }
  throw new Error('No SMS provider configured (or DEV_PRINT_OTP=1 not set in development) — see src/auth/send-code.ts');
}

/**
 * Delivers an email sign-in code.
 *
 * Development: prints the code in the API terminal (free).
 * Production: plug in an email provider here (e.g. Resend) before launch.
 */
export async function sendEmailCode(email: string, code: string): Promise<void> {
  if (env.NODE_ENV === 'development' && env.DEV_PRINT_OTP === '1') {
    console.log(`\n  [DEV] Email code for ${email}: ${code}\n`);
    return;
  }
  throw new Error('No email provider configured (or DEV_PRINT_OTP=1 not set in development) — see src/auth/send-code.ts');
}
