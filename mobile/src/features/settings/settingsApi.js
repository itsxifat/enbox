/**
 * Account/profile/settings mutations and value labels shared by the settings pages (agent 1).
 */
import { formatTimer } from '@enbox/shared';
import { api } from '@/lib/api';
import { getMe, useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';

/**
 * PATCH /api/me/settings with an optimistic update (reverted on failure). The server
 * echoes the merged settings; `me:updated` also reaches my other devices.
 */
export async function updateSettings(patch) {
  const me = getMe();
  if (!me) return false;
  const before = me.settings;
  useAuth.getState().patchUser({ settings: { ...before, ...patch } });
  try {
    const settings = await api.patch('/api/me/settings', patch);
    useAuth.getState().patchUser({ settings });
    return true;
  } catch (e) {
    const current = getMe();
    if (current) {
      // Revert only the keys we changed.
      const reverted = { ...current.settings };
      for (const k of Object.keys(patch)) reverted[k] = before[k];
      useAuth.getState().patchUser({ settings: reverted });
    }
    toast.error(e);
    return false;
  }
}

/** Fields of `UpdateProfileRequest` that map 1:1 onto `UserSelf` (applied optimistically). */
const PROFILE_FIELDS = [
  'displayName',
  'about',
  'username',
  'phone',
  'pronouns',
  'bio',
  'profileColor',
  'accentColor',
];

/**
 * PATCH /api/me with an optimistic update of the text / colour fields (reverted on failure;
 * media ids only take effect through the response). The returned profile replaces the
 * cached one. Throws on failure.
 */
export async function updateProfile(patch) {
  const me = getMe();
  const before = {};
  const optimistic = {};
  if (me)
    for (const k of PROFILE_FIELDS) {
      if (patch[k] === undefined) continue;
      before[k] = me[k];
      optimistic[k] = patch[k];
    }
  if (Object.keys(optimistic).length) useAuth.getState().patchUser(optimistic);
  try {
    const user = await api.patch('/api/me', patch);
    useAuth.getState().setUser(user);
    return user;
  } catch (e) {
    if (Object.keys(before).length && getMe()) useAuth.getState().patchUser(before);
    throw e;
  }
}

export const PRIVACY_LABELS = {
  everyone: 'Everyone',
  contacts: 'My contacts',
  nobody: 'Nobody',
};

export function lastSeenSummary(s) {
  const lastSeen = PRIVACY_LABELS[s.lastSeenVisibility];
  const online = s.onlineVisibility === 'everyone' ? 'Everyone' : 'Same as last seen';
  return s.lastSeenVisibility === 'everyone' && s.onlineVisibility === 'everyone'
    ? 'Everyone'
    : `${lastSeen}, online: ${online.toLowerCase()}`;
}

export function statusPrivacySummary(s) {
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

export function timerLabel(seconds) {
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
];
