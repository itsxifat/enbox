/**
 * Account/profile/settings mutations and value labels shared by the settings pages (agent 1).
 */
import {
  formatTimer,
  type PrivacyLevel,
  type UpdateProfileRequest,
  type UserSelf,
  type UserSettings,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { getMe, useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';

/**
 * PATCH /api/me/settings with an optimistic update (reverted on failure). The server
 * echoes the merged settings; `me:updated` also reaches my other devices.
 */
export async function updateSettings(patch: Partial<UserSettings>): Promise<boolean> {
  const me = getMe();
  if (!me) return false;
  const before = me.settings;
  useAuth.getState().patchUser({ settings: { ...before, ...patch } });
  try {
    const settings = await api.patch<UserSettings>('/api/me/settings', patch);
    useAuth.getState().patchUser({ settings });
    return true;
  } catch (e) {
    const current = getMe();
    if (current) {
      // Revert only the keys we changed.
      const reverted = { ...current.settings };
      for (const k of Object.keys(patch) as (keyof UserSettings)[])
        (reverted as Record<string, unknown>)[k] = before[k];
      useAuth.getState().patchUser({ settings: reverted });
    }
    toast.error(e);
    return false;
  }
}

/** PATCH /api/me; the returned profile replaces the cached one. Throws on failure. */
export async function updateProfile(patch: UpdateProfileRequest): Promise<UserSelf> {
  const user = await api.patch<UserSelf>('/api/me', patch);
  useAuth.getState().setUser(user);
  return user;
}

export const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  everyone: 'Everyone',
  contacts: 'My contacts',
  nobody: 'Nobody',
};

export function lastSeenSummary(
  s: Pick<UserSettings, 'lastSeenVisibility' | 'onlineVisibility'>,
): string {
  const lastSeen = PRIVACY_LABELS[s.lastSeenVisibility];
  const online = s.onlineVisibility === 'everyone' ? 'Everyone' : 'Same as last seen';
  return s.lastSeenVisibility === 'everyone' && s.onlineVisibility === 'everyone'
    ? 'Everyone'
    : `${lastSeen}, online: ${online.toLowerCase()}`;
}

export function statusPrivacySummary(
  s: Pick<UserSettings, 'statusPrivacy' | 'statusExcludeUserIds' | 'statusOnlyShareWithUserIds'>,
): string {
  if (s.statusPrivacy === 'contacts_except') {
    const n = s.statusExcludeUserIds.length;
    return n ? `${n} contact${n === 1 ? '' : 's'} excluded` : 'My contacts except…';
  }
  if (s.statusPrivacy === 'only_share_with') {
    const n = s.statusOnlyShareWithUserIds.length;
    return `${n} contact${n === 1 ? '' : 's'} selected`;
  }
  return 'My contacts';
}

export function timerLabel(seconds: number | null): string {
  return seconds ? formatTimer(seconds) : 'Off';
}

export const ABOUT_PRESETS = [
  'Available',
  'Busy',
  'At school',
  'At the movies',
  'At work',
  'Battery about to die',
  "Can't talk, Enbox only",
  'In a meeting',
  'At the gym',
  'Sleeping',
  'Urgent calls only',
] as const;
