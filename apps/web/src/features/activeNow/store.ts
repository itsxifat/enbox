/**
 * Active Now (docs/design/discord-parity.md W9-E): my friends in voice, one card per channel —
 * `GET /api/me/friends/activity` (the server keeps to friends, Spaces I am in and channels I
 * can see, and orders the cards).
 *
 * Live while the column is shown (`useLiveFriendActivity`, ref-counted): a voice state change
 * (`voice:state`, through the voice store) of a contact — a friend, the server tells — or in a
 * channel on a card refetches, at most once per ACTIVITY_REFRESH_MS; so do my contacts or the
 * people I ignore changing, and every socket `ready`. Overlapping loads collapse into one more.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { FriendActivity, ID, VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { onReady } from '@/lib/socket';
import { useContacts, type ContactEntry } from '@/stores/contacts';
import { useIgnores } from '@/stores/ignores';
import { useVoice } from '@/stores/voice';

/** Live updates wait this long, so a burst of voice changes costs one request. */
export const ACTIVITY_REFRESH_MS = 1_000;

interface ActiveNowState {
  items: FriendActivity[];
  loaded: boolean;
  load(): Promise<void>;
}

let inflight: Promise<void> | null = null;
let again = false;

export const useActiveNow = create<ActiveNowState>((set, get) => ({
  items: [],
  loaded: false,

  load() {
    if (inflight) {
      again = true;
      return inflight;
    }
    const epoch = sessionEpoch();
    const run = api
      .get<FriendActivity[]>('/api/me/friends/activity')
      .then(
        (items) => {
          if (epoch === sessionEpoch()) set({ items, loaded: true });
        },
        (e: unknown) => {
          // Shown as it was (the empty state at first); the next change tries again.
          if (epoch === sessionEpoch()) set({ loaded: true });
          throw e;
        },
      )
      .finally(() => {
        inflight = null;
        if (again) {
          again = false;
          void get()
            .load()
            .catch(() => undefined);
        }
      });
    inflight = run;
    return run;
  },
}));

registerSessionReset(() => {
  inflight = null;
  again = false;
  useActiveNow.setState({ items: [], loaded: false });
});

let contactsOf: ContactEntry[] | null = null;
let contactIds = new Set<ID>();
function isContact(id: ID): boolean {
  const { contacts } = useContacts.getState();
  if (contacts !== contactsOf) {
    contactsOf = contacts;
    contactIds = new Set(contacts.map((c) => c.userId));
  }
  return contactIds.has(id);
}

/** Users whose voice state is not the same object any more. */
function changedUsers(a: Record<ID, VoiceState>, b: Record<ID, VoiceState>): ID[] {
  const out: ID[] = [];
  for (const id in a) if (a[id] !== b[id]) out.push(id);
  for (const id in b) if (!(id in a)) out.push(id);
  return out;
}

/** Whether a voice change of `userId` (from / to these channels) can change a card. */
function matters(userId: ID, channels: (ID | undefined)[]): boolean {
  if (isContact(userId)) return true;
  const { items } = useActiveNow.getState();
  return channels.some((c) => !!c && items.some((a) => a.channelId === c));
}

function listen(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = () => {
    timer ??= setTimeout(() => {
      timer = null;
      void useActiveNow
        .getState()
        .load()
        .catch(() => undefined);
    }, ACTIVITY_REFRESH_MS);
  };
  const offVoice = useVoice.subscribe((s, prev) => {
    if (s.byUser === prev.byUser) return;
    for (const id of changedUsers(s.byUser, prev.byUser))
      if (matters(id, [s.byUser[id]?.channelId, prev.byUser[id]?.channelId])) return refresh();
  });
  const offContacts = useContacts.subscribe((s, prev) => {
    if (s.contacts !== prev.contacts) refresh();
  });
  const offIgnores = useIgnores.subscribe((s, prev) => {
    if (s.ids !== prev.ids) refresh();
  });
  const offReady = onReady(refresh);
  return () => {
    offVoice();
    offContacts();
    offIgnores();
    offReady();
    if (timer) clearTimeout(timer);
  };
}

let listeners = 0;
let stop: (() => void) | null = null;

/** Load the activity and keep it live while mounted. */
export function useLiveFriendActivity(): void {
  useEffect(() => {
    void useActiveNow
      .getState()
      .load()
      .catch(() => undefined);
    if (listeners++ === 0) stop = listen();
    return () => {
      if (--listeners === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
}
