/** Trimmed + lowercased, the way the API stores it. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Quick shape check before calling the API (the API does the real validation). */
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
