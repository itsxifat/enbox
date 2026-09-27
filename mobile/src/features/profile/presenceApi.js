/**
 * My availability and presence note (`PUT /api/me/presence`, `PUT|DELETE /api/me/presence-note`).
 * The server echoes `UserSelf` (and `me:updated` reaches my other devices); it fans a
 * `presence:update` to my subscribers and never a `user:changed`. Throws on failure.
 */

import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export async function setAvailability(availability, until) {
  const user = await api.put('/api/me/presence', { availability, until });
  useAuth.getState().setUser(user);
  return user;
}

export async function setPresenceNote(note) {
  const user = await api.put('/api/me/presence-note', note);
  useAuth.getState().setUser(user);
  return user;
}

export async function clearPresenceNote() {
  const user = await api.delete('/api/me/presence-note');
  useAuth.getState().setUser(user);
  return user;
}

const MINUTE = 60_000;

/** "For 30 minutes" … "Until I change it" (null = no expiry). */
export const AVAILABILITY_DURATIONS = [
  { value: '30m', label: 'For 30 minutes', ms: 30 * MINUTE },
  { value: '1h', label: 'For 1 hour', ms: 60 * MINUTE },
  { value: '8h', label: 'For 8 hours', ms: 8 * 60 * MINUTE },
  { value: 'forever', label: 'Until I change it', ms: null },
];

/** "Clear after" choices of the custom status; `today` = the end of the local day. */
export const NOTE_DURATIONS = [
  { value: 'never', label: "Don't clear" },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'Today' },
];

/** ISO expiry for a duration choice, or null for no expiry. */
export function expiryFor(value, now = new Date()) {
  switch (value) {
    case '30m':
      return new Date(now.getTime() + 30 * MINUTE).toISOString();
    case '1h':
      return new Date(now.getTime() + 60 * MINUTE).toISOString();
    case '4h':
      return new Date(now.getTime() + 4 * 60 * MINUTE).toISOString();
    case '8h':
      return new Date(now.getTime() + 8 * 60 * MINUTE).toISOString();
    case 'today': {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return end.toISOString();
    }
    default:
      return null;
  }
}
