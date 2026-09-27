/**
 * Form helpers: validate with the shared zod schemas from @enbox/shared and map issues to
 * per-field messages.
 *
 *   const r = validate(registerSchema, values);
 *   if (!r.ok) return setErrors(r.errors);   // { username: 'Use 3–32 lowercase…' }
 *   await register(r.data);
 */

/** Structural type of a zod schema's `safeParse` (avoids a direct zod dependency). */

export function issuesToFieldErrors(issues) {
  const out = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function validate(schema, values) {
  const r = schema.safeParse(values);
  return r.success
    ? { ok: true, data: r.data }
    : { ok: false, errors: issuesToFieldErrors(r.error.issues) };
}
