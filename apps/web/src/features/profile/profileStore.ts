/**
 * Full profiles (`GET /api/users/:userId/profile`) and my private notes, shared by the popout,
 * the full profile modal and the profile page so a note typed in one shows in the others.
 *
 * - `load(userId)` fetches a fresh profile (one request per user in flight); the subject and
 *   the mutual friends go into the users store, so every surface shows their fresh profile.
 * - `saveNote(userId, note)` is optimistic: the note shows at once, a failure restores the
 *   previous one (with a toast). Only the latest save of a user applies its result, and a
 *   profile that loads meanwhile never overwrites a note being saved.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ID, UserProfile } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { getMyId } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { useUsers } from '@/stores/users';

interface ProfilesState {
  byId: Record<ID, UserProfile>;
  /** My note per subject; absent = not loaded yet. */
  notes: Record<ID, string | null>;
  load(userId: ID): Promise<UserProfile>;
  saveNote(userId: ID, note: string): Promise<boolean>;
}

const inflight = new Map<ID, Promise<UserProfile>>();
/** Latest note save per subject (older saves don't apply their results). */
const noteSeq = new Map<ID, number>();

function isProfile(p: unknown): p is UserProfile {
  return !!p && typeof p === 'object' && !!(p as UserProfile).user?.id;
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  byId: {},
  notes: {},

  load(userId) {
    const running = inflight.get(userId);
    if (running) return running;
    const epoch = sessionEpoch();
    const req = api
      .get<UserProfile>(`/api/users/${userId}/profile`)
      .then((p) => {
        if (!isProfile(p)) throw new Error('Unexpected profile response');
        if (epoch !== sessionEpoch()) return p;
        const users = p.user.id === getMyId() ? p.mutualFriends : [p.user, ...p.mutualFriends];
        if (users.length) useUsers.getState().upsertUsers(users);
        set((s) => ({
          byId: { ...s.byId, [userId]: p },
          notes: noteSeq.has(userId) ? s.notes : { ...s.notes, [userId]: p.note },
        }));
        return p;
      })
      .finally(() => inflight.delete(userId));
    inflight.set(userId, req);
    return req;
  },

  async saveNote(userId, raw) {
    const note = raw.trim();
    const prev = get().notes[userId] ?? null;
    if ((prev ?? '') === note) return true;
    const seq = (noteSeq.get(userId) ?? 0) + 1;
    noteSeq.set(userId, seq);
    const put = (value: string | null) =>
      set((s) => ({ notes: { ...s.notes, [userId]: value } }));
    put(note || null);
    const epoch = sessionEpoch();
    try {
      const res = await api.put<{ note: string | null }>(`/api/users/${userId}/note`, { note });
      if (epoch === sessionEpoch() && noteSeq.get(userId) === seq) put(res?.note ?? (note || null));
      return true;
    } catch (e) {
      if (epoch === sessionEpoch() && noteSeq.get(userId) === seq) {
        put(prev);
        toast.error(e);
      }
      return false;
    } finally {
      if (noteSeq.get(userId) === seq) noteSeq.delete(userId);
    }
  },
}));

/**
 * The full profile of a user, refetched on every mount (mutuals change; Discord does the
 * same) while the cached one shows meanwhile. `null` skips loading.
 */
export function useUserProfile(userId: ID | null | undefined): {
  profile: UserProfile | undefined;
  error: unknown;
} {
  const profile = useProfiles((s) => (userId ? s.byId[userId] : undefined));
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setError(null);
    useProfiles
      .getState()
      .load(userId)
      .catch((e: unknown) => {
        if (alive) setError(e);
      });
    return () => {
      alive = false;
    };
  }, [userId]);
  return { profile, error };
}

registerSessionReset(() => {
  inflight.clear();
  noteSeq.clear();
  useProfiles.setState({ byId: {}, notes: {} });
});
