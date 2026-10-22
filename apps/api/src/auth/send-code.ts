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

/**
 * Sends a code to the account's CURRENT email/phone to approve replacing it.
 * The message names the (masked) new value, so it doubles as a warning to the real owner:
 *   "MechaniFind: 123456 is your code to approve changing your email to j***@gmail.com.
 *    If this wasn't you, don't share it. Your account is safe."
 */
export async function sendContactChangeCode(
  channel: 'email' | 'phone', oldAddress: string, code: string, maskedNewValue: string,
): Promise<void> {
  if (env.NODE_ENV === 'development' && env.DEV_PRINT_OTP === '1') {
    // Code is the last word, like the other dev lines, so the test scripts can read it.
    console.log(`\n  [DEV] Approval (change ${channel} to ${maskedNewValue}) code for ${oldAddress}: ${code}\n`);
    return;
  }
  throw new Error('No SMS/email provider configured (or DEV_PRINT_OTP=1 not set in development) — see src/auth/send-code.ts');
}
