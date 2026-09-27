/**
 * Live username availability for the register form and the profile's "Edit username":
 * `GET /api/auth/username-available?username=` (public, per-IP rate-limited) answers exactly
 * whether register / a rename could take the name (taken — deleted accounts included — or
 * reserved → false). Advisory only: the server still answers 409 if someone takes it first.
 */
import { useEffect, useState } from 'react';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError, api } from '@/lib/api';
import { usernameIssue } from './validation';

/** One availability request; errors are mapped (400 → invalid, anything else → unknown). */
export async function checkUsername(username, signal) {
  try {
    const r = await api.get('/api/auth/username-available', {
      query: { username },
      signal,
    });
    return { state: r.available ? 'available' : 'taken' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400)
      return { state: 'invalid', message: e.message || 'Invalid username' };
    if (e instanceof ApiError && e.code === 'aborted') throw e;
    return { state: 'unknown' };
  }
}

export function useUsernameAvailability(value, opts = {}) {
  const { current, delayMs = 400 } = opts;
  const debounced = useDebouncedValue(value, delayMs);
  const [result, setResult] = useState(null);
  const issue = value ? usernameIssue(value) : null;

  useEffect(() => {
    if (!debounced || debounced === current || usernameIssue(debounced)) return;
    const ctrl = new AbortController();
    checkUsername(debounced, ctrl.signal)
      .then((r) => setResult({ for: debounced, r }))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [debounced, current]);

  if (!value) return { state: 'idle', message: null };
  if (issue) return { state: 'invalid', message: issue };
  if (current !== undefined && value === current)
    return { state: 'mine', message: 'This is your current username.' };
  if (value !== debounced || result?.for !== value) return { state: 'checking', message: null };
  switch (result.r.state) {
    case 'available':
      return { state: 'available', message: `@${value} is available.` };
    case 'taken':
      return { state: 'taken', message: `@${value} is taken.` };
    case 'invalid':
      return { state: 'invalid', message: result.r.message ?? 'Invalid username' };
    default:
      return { state: 'unknown', message: 'Couldn’t check availability.' };
  }
}
