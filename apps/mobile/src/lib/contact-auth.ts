import { authClient } from '@/lib/auth-client';
import type { Method } from '@/components/contact-input';

type ApiError = { code?: string; status?: number; message?: string } | null;
type Result = Promise<{ error: ApiError }>;

/**
 * The four code flows in one place:
 * - sign in with phone or email
 * - (signed in) add a phone or email to the current account
 */
export function sendCode(method: Method, value: string, mode: 'sign-in' | 'link'): Result {
  if (method === 'phone') return authClient.phoneNumber.sendOtp({ phoneNumber: value }) as Result;
  if (mode === 'link') return authClient.emailOtp.requestEmailChange({ newEmail: value }) as Result;
  return authClient.emailOtp.sendVerificationOtp({ email: value, type: 'sign-in' }) as Result;
}

export function confirmCode(method: Method, value: string, code: string, mode: 'sign-in' | 'link'): Result {
  if (method === 'phone') {
    return authClient.phoneNumber.verify({
      phoneNumber: value,
      code,
      ...(mode === 'link' ? { updatePhoneNumber: true } : {}),
    }) as Result;
  }
  if (mode === 'link') return authClient.emailOtp.changeEmail({ newEmail: value, otp: code }) as Result;
  return authClient.signIn.emailOtp({ email: value, otp: code }) as Result;
}
