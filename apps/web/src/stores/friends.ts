/**
 * Friends store — my pending friend requests (W7-A). Friends themselves are my contacts
 * (stores/contacts.ts): accepting a request saves both users as each other's contacts, so
 * the friend list is `useContactList()` and "is a friend" is `UserPublic.isContact`.
 *
 * State
 * - `incoming` / `outgoing`  pending requests `{ userId, createdAt }`, newest first; the
 *                            profiles live in the users store (upserted on load), so rows stay
 *                            live on `user:changed`
 * - `loaded`
 *
 * Actions
 * - `load({ force })`        GET /api/friends/requests (deduped; cached unless force)
 * - `sync()`                 refetch after `friends:changed` and on every `ready` (a burst of
 *                            calls costs at most two requests)
 * - `send(req)`              POST /api/friends/requests → 'sent' | 'accepted'
 * - `accept(userId)`         POST /api/friends/requests/:userId/accept
 * - `decline(userId)` / `cancel(userId)`  DELETE /api/friends/requests/:userId
 * - `removeFriend(userId)`   DELETE /api/friends/:userId (both sides)
 * - `applyIncoming(request)` a `friends:request` event
 *
 * Mutations update the lists (and, for accept / remove, the contacts and users stores) right
 * away; the socket events that follow (`friends:changed`, `contacts:changed`) resync them.
 *
 * Hooks: `useFriendRequests()` (auto-loads; live profiles), `useIncomingFriendRequestCount()`
 * (the red badge), `useFriendStatus(user)`.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type {
  FriendRequest,
  FriendRequests,
  ID,
  SendFriendRequest,
  SendFriendRequestResult,
  UserPublic,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useAuth } from './auth';
import { patchUserEverywhere, useContacts } from './contacts';
import { useUsers } from './users';

export interface PendingEntry {
  userId: ID;
  createdAt: string;
}

export interface FriendsState {
  incoming: PendingEntry[];
  outgoing: PendingEntry[];
  loaded: boolean;

  load(opts?: { force?: boolean }): Promise<void>;
  sync(): Promise<void>;
  send(req: SendFriendRequest): Promise<SendFriendRequestResult['status']>;
  accept(userId: ID): Promise<void>;
  decline(userId: ID): Promise<void>;
  cancel(userId: ID): Promise<void>;
  removeFriend(userId: ID): Promise<void>;
  applyIncoming(request: FriendRequest): void;
}

const initialState = {
  incoming: [] as PendingEntry[],
  outgoing: [] as PendingEntry[],
  loaded: false,
};

let loading: Promise<void> | null = null;
/** A sync was asked for while one was in flight: run once more when it ends. */
let syncAgain = false;

const entry = (r: FriendRequest): PendingEntry => ({ userId: r.user.id, createdAt: r.createdAt });
const without = (list: PendingEntry[], userId: ID) => list.filter((e) => e.userId !== userId);

/** Save `userId` as my contact everywhere (accepting made us friends: their display name shows). */
function becameFriend(userId: ID): void {
  patchUserEverywhere(userId, { isContact: true });
  useContacts.setState((s) =>
    s.contacts.some((c) => c.userId === userId)
      ? s
      : {
          contacts: [...s.contacts, { userId, name: null, createdAt: new Date().toISOString() }],
        },
  );
}

export const useFriends = create<FriendsState>((set, get) => {
  /** One GET, applied unless the session changed meanwhile. */
  const fetchRequests = async () => {
    const epoch = sessionEpoch();
    const res = await api.get<FriendRequests>('/api/friends/requests');
    if (epoch !== sessionEpoch()) return;
    useUsers.getState().upsertUsers([...res.incoming, ...res.outgoing].map((r) => r.user));
    set({ incoming: res.incoming.map(entry), outgoing: res.outgoing.map(entry), loaded: true });
  };

  const run = (): Promise<void> => {
    const p: Promise<void> = fetchRequests().finally(() => {
      if (loading !== p) return; // a logout dropped it meanwhile
      loading = null;
      if (syncAgain) {
        syncAgain = false;
        void run().catch(() => undefined);
      }
    });
    loading = p;
    return p;
  };

  return {
    ...initialState,

    load({ force = false } = {}) {
      if (get().loaded && !force) return Promise.resolve();
      return loading ?? run();
    },

    sync() {
      if (loading) {
        syncAgain = true;
        return loading.catch(() => undefined);
      }
      return run().catch(() => undefined);
    },

    async send(req) {
      const { status } = await api.post<SendFriendRequestResult>('/api/friends/requests', req);
      // The new request (or friend) shows once the lists are refetched.
      void get().sync();
      if (status === 'accepted') void useContacts.getState().syncContacts();
      return status;
    },

    async accept(userId) {
      await api.post(`/api/friends/requests/${userId}/accept`);
      set((s) => ({
        incoming: without(s.incoming, userId),
        outgoing: without(s.outgoing, userId),
      }));
      becameFriend(userId);
    },

    async decline(userId) {
      await api.delete(`/api/friends/requests/${userId}`);
      set((s) => ({ incoming: without(s.incoming, userId) }));
    },

    async cancel(userId) {
      await api.delete(`/api/friends/requests/${userId}`);
      set((s) => ({ outgoing: without(s.outgoing, userId) }));
    },

    async removeFriend(userId) {
      await api.delete(`/api/friends/${userId}`);
      patchUserEverywhere(userId, { isContact: false, contactName: null });
      useContacts.setState((s) => ({ contacts: s.contacts.filter((c) => c.userId !== userId) }));
    },

    applyIncoming(request) {
      useUsers.getState().upsertUsers([request.user]);
      set((s) => ({
        incoming: [entry(request), ...without(s.incoming, request.user.id)],
        outgoing: without(s.outgoing, request.user.id),
      }));
    },
  };
});

registerSessionReset(() => {
  loading = null;
  syncAgain = false;
  useFriends.setState({ ...initialState });
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface PendingItem {
  user: UserPublic;
  createdAt: string;
}

/** My pending requests with live profiles (auto-loads), newest first. */
export function useFriendRequests(): {
  incoming: PendingItem[];
  outgoing: PendingItem[];
  loaded: boolean;
} {
  const incoming = useFriends((s) => s.incoming);
  const outgoing = useFriends((s) => s.outgoing);
  const loaded = useFriends((s) => s.loaded);
  const byId = useUsers((s) => s.byId);
  useEffect(() => {
    if (!loaded)
      void useFriends
        .getState()
        .load()
        .catch(() => undefined);
  }, [loaded]);
  return useMemo(() => {
    const live = (list: PendingEntry[]) =>
      list.flatMap((e) => {
        const user = byId[e.userId];
        return user && !user.isDeleted ? [{ user, createdAt: e.createdAt }] : [];
      });
    return { incoming: live(incoming), outgoing: live(outgoing), loaded };
  }, [incoming, outgoing, loaded, byId]);
}

/** Friend requests waiting for my answer (the red badge on Friends, Pending and Home). */
export function useIncomingFriendRequestCount(): number {
  return useFriends((s) => s.incoming.length);
}

export type FriendStatus = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';

/** Where I stand with `user`: a friend (a contact), a request either way, or nothing yet. */
export function useFriendStatus(user: Pick<UserPublic, 'id' | 'isContact'>): FriendStatus {
  const me = useAuth((s) => s.user?.id);
  const isContact = useUsers((s) => s.byId[user.id]?.isContact ?? user.isContact);
  const incoming = useFriends((s) => s.incoming.some((e) => e.userId === user.id));
  const outgoing = useFriends((s) => s.outgoing.some((e) => e.userId === user.id));
  if (user.id === me) return 'self';
  if (isContact) return 'friend';
  return incoming ? 'incoming' : outgoing ? 'outgoing' : 'none';
}
