// US numbers only for now.

const digitsOnly = (s: string) => s.replace(/\D/g, '');

function nationalDigits(input: string): string {
  let d = digitsOnly(input);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1); // driver typed the leading 1
  return d.slice(0, 10);
}

/** As-you-type display: (815) 555-0123 */
export function formatUSPhone(input: string): string {
  const d = nationalDigits(input);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** The format the API requires: +18155550123. Null if it isn't a valid US number. */
export function toE164(input: string): string | null {
  const d = nationalDigits(input);
  if (d.length !== 10 || d[0] === '0' || d[0] === '1' || d[3] === '0' || d[3] === '1') return null;
  return `+1${d}`;
}

/** Same rule the API enforces: a real US number in +1XXXXXXXXXX form. */
export function isUSE164(value: unknown): value is string {
  return typeof value === 'string' && /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(value);
}

/** +18155550123 -> (815) 555-0123 */
export function displayE164(e164: string): string {
  return formatUSPhone(e164.replace(/^\+1/, ''));
}
