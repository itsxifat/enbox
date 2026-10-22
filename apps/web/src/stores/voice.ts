/**
 * Voice channels: who is connected where (`voice_states`, one per account, kept current by
 * `voice:state` events) and my own connection (`features/voice/engine.ts` drives it).
 *
 * - `byUser`        every known voice state, by user (a user is in at most one channel)
 * - `loadedSpaces`  Spaces whose states were fetched (`GET /api/spaces/:id/voice-states`)
 * - `connection`    my voice connection: channel, status, error
 * - `speaking`      who is speaking in my room right now (LiveKit active speakers)
 * - `roomVersion`   bumps whenever the media room changes (participants, tracks), for views
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ID, VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';

export type VoiceStatus = 'connecting' | 'connected' | 'reconnecting';

export interface VoiceConnection {
  spaceId: ID;
  channelId: ID;
  status: VoiceStatus;
}

export interface VoiceStoreState {
  byUser: Record<ID, VoiceState>;
  loadedSpaces: Record<ID, boolean>;
  connection: VoiceConnection | null;
  speaking: Record<ID, true>;
  /** Remote audio is blocked by the browser's autoplay policy until a click. */
  audioBlocked: boolean;
  roomVersion: number;

  loadSpace(spaceId: ID, opts?: { force?: boolean }): Promise<void>;
  applyState(p: { spaceId: ID; channelId: ID; userId: ID; state: VoiceState | null }): void;
  setConnection(c: VoiceConnection | null): void;
  setSpeaking(ids: ID[]): void;
  bumpRoom(): void;
}

const initial = {
  byUser: {} as Record<ID, VoiceState>,
  loadedSpaces: {} as Record<ID, boolean>,
  connection: null as VoiceConnection | null,
  speaking: {} as Record<ID, true>,
  audioBlocked: false,
  roomVersion: 0,
};

const inflight = new Map<ID, Promise<void>>();

export const useVoice = create<VoiceStoreState>((set, get) => ({
  ...initial,

  loadSpace(spaceId, opts = {}) {
    if (!opts.force && get().loadedSpaces[spaceId]) return Promise.resolve();
    const running = inflight.get(spaceId);
    if (running) return running;
    const p = api
      .get<VoiceState[]>(`/api/spaces/${spaceId}/voice-states`)
      .then((states) =>
        set((s) => {
          const byUser = { ...s.byUser };
          for (const [uid, st] of Object.entries(byUser)) if (st.spaceId === spaceId) delete byUser[uid];
          for (const st of states) byUser[st.userId] = st;
          return { byUser, loadedSpaces: { ...s.loadedSpaces, [spaceId]: true } };
        }),
      )
      .finally(() => inflight.delete(spaceId));
    inflight.set(spaceId, p);
    return p;
  },

  applyState({ channelId, userId, state }) {
    set((s) => {
      const cur = s.byUser[userId];
      if (!state) {
        // Leaving one channel after joining another must not erase the new one.
        if (!cur || cur.channelId !== channelId) return s;
        const byUser = { ...s.byUser };
        delete byUser[userId];
        return { byUser };
      }
      return { byUser: { ...s.byUser, [userId]: state } };
    });
  },

  setConnection(connection) {
    set(connection ? { connection } : { connection: null, speaking: {}, audioBlocked: false });
  },

  setSpeaking(ids) {
    const speaking: Record<ID, true> = {};
    for (const id of ids) speaking[id] = true;
    set({ speaking });
  },

  bumpRoom() {
    set((s) => ({ roomVersion: s.roomVersion + 1 }));
  },
}));

registerSessionReset(() => {
  inflight.clear();
  useVoice.setState({ ...initial });
});

/** People in a voice channel, in join order. */
export function useVoiceChannelStates(channelId: ID | null | undefined): VoiceState[] {
  const byUser = useVoice((s) => s.byUser);
  return useMemo(() => {
    if (!channelId) return [];
    return Object.values(byUser)
      .filter((v) => v.channelId === channelId)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId));
  }, [byUser, channelId]);
}

/** Whether anyone is in voice in this Space (rail speaker glyph). */
export function useSpaceHasVoice(spaceId: ID): boolean {
  return useVoice((s) => Object.values(s.byUser).some((v) => v.spaceId === spaceId));
}
