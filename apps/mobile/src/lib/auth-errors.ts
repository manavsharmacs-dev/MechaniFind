type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

export const CANT_CONNECT = "Can't reach MechaniFind. Check your connection and try again.";

/** Turns API errors into messages that tell the driver what to do next. */
export function authErrorMessage(err: AuthError): string {
  if (!err) return 'Something went wrong. Try again.';
  if (err.status === 429) return 'Too many codes requested. Wait a few minutes, then try again.';
  if (err.status === 503) return 'Sign-in is busy right now. Please try again later.';
  switch (err.code) {
    case 'INVALID_PHONE_NUMBER':
      return 'Enter a 10-digit US phone number.';
    case 'INVALID_EMAIL':
      return 'Enter a valid email address.';
    case 'DISPOSABLE_EMAIL':
      return 'Please use a permanent email address, not a temporary inbox.';
    case 'PHONE_NUMBER_EXIST':
      return 'That number is already on another MechaniFind account.';
    case 'INVALID_OTP':
      return "That code isn't right. Check it and try again.";
    case 'OTP_EXPIRED':
    case 'OTP_NOT_FOUND':
      return 'That code expired. Send a new one.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many wrong tries. Send a new code.';
  }
  if (!err.status) return CANT_CONNECT;
  return 'Something went wrong. Try again.';
}
