import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

/**
 * Validates a JSON body against a strict schema. Unknown fields are rejected
 * (so nobody can sneak in "isApproved": true), and the error never echoes back
 * what was sent — only which fields were wrong.
 */
export const jsonBody = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(body)'))];
      return c.json({ error: 'invalid_input', fields }, 400);
    }
  });

// Invisible / direction-flipping characters that can disguise text in the UI.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

/** User-typed text: normalized, invisible characters removed, spaces tidied, length-checked. */
export const cleanText = (min: number, max: number) =>
  z
    .string()
    .max(max * 2) // reject absurd input before doing any work
    .transform((s) => s.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

/** A GPS point inside the United States (incl. Alaska & Hawaii). */
export const usLocation = z
  .object({
    lat: z.number().min(18).max(72),
    lng: z.number().min(-180).max(-65),
  })
  .strict();
