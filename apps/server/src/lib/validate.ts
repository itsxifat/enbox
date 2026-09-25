import type { z } from 'zod';
import { HttpError } from './errors.js';

/**
 * Parse `input` with a zod schema, throwing `400 validation_error` with zod issues on failure.
 * Use for req.body, req.query, req.params and socket payloads.
 */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw new HttpError(400, 'validation_error', `${where}${first?.message ?? 'Invalid input'}`, result.error.issues);
  }
  return result.data;
}
