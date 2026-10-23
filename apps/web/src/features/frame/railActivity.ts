/**
 * A Space's activity for its rail tile, from the data at hand: I'm in one of its voice
 * channels (a speaker), someone there is streaming (LIVE: the Spaces whose voice states are
 * loaded), one of its events is on (a calendar: the Spaces whose event list is loaded).
 */
import { useMemo } from 'react';
import type { ID, VoiceState } from '@enbox/shared';
import { useEvents } from '@/stores/events';
import { useVoice } from '@/stores/voice';

export interface SpaceActivity {
  voice: boolean;
  live: boolean;
  event: boolean;
}

const streamingBy = new WeakMap<Record<ID, VoiceState>, Set<ID>>();

/** The Spaces where someone streams, worked out once per voice state map (every tile asks). */
export function streamingSpaces(byUser: Record<ID, VoiceState>): Set<ID> {
  let set = streamingBy.get(byUser);
  if (!set) {
    set = new Set();
    for (const v of Object.values(byUser)) if (v.selfStream) set.add(v.spaceId);
    streamingBy.set(byUser, set);
  }
  return set;
}

export function useSpaceActivity(spaceId: ID): SpaceActivity {
  const voice = useVoice((s) => s.connection?.spaceId === spaceId);
  const live = useVoice((s) => streamingSpaces(s.byUser).has(spaceId));
  const event = useEvents((s) => !!s.bySpace[spaceId]?.some((e) => e.status === 'active'));
  return useMemo(() => ({ voice, live, event }), [voice, live, event]);
}

/** I'm in voice in one of these Spaces (a closed folder's speaker). */
export function useInVoiceAmong(spaceIds: readonly ID[]): boolean {
  return useVoice((s) => !!s.connection && spaceIds.includes(s.connection.spaceId));
}

/** What a tile's accessible name adds for its activity. */
export function activityWords(a: SpaceActivity): string[] {
  return [a.voice && 'in voice', a.live && 'live', a.event && 'event happening now'].filter(
    (w): w is string => !!w,
  );
}
