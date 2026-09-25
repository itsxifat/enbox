/**
 * Form helpers: validate with the shared zod schemas from @enbox/shared and map issues to
 * per-field messages.
 *
 *   const r = validate(registerSchema, values);
 *   if (!r.ok) return setErrors(r.errors);   // { username: 'Use 3–32 lowercase…' }
 *   await register(r.data);
 */

export type FieldErrors = Record<string, string>;

interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

/** Structural type of a zod schema's `safeParse` (avoids a direct zod dependency). */
export interface SafeParser<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

export function issuesToFieldErrors(issues: readonly Issue[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

export function validate<T>(schema: SafeParser<T>, values: unknown): ValidationResult<T> {
  const r = schema.safeParse(values);
  return r.success
    ? { ok: true, data: r.data }
    : { ok: false, errors: issuesToFieldErrors(r.error.issues) };
}
