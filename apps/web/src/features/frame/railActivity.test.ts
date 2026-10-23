import { describe, expect, it } from 'vitest';
import type { VoiceState } from '@enbox/shared';
import { activityWords, streamingSpaces } from './railActivity';

const voice = (userId: string, spaceId: string, selfStream: boolean): VoiceState => ({
  userId,
  spaceId,
  channelId: `${spaceId}-voice`,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
});

describe('rail activity', () => {
  it('finds the Spaces where someone streams, once per voice state map', () => {
    const byUser = { u1: voice('u1', 'a', false), u2: voice('u2', 'b', true), u3: voice('u3', 'b', false) };
    const live = streamingSpaces(byUser);
    expect([...live]).toEqual(['b']);
    expect(streamingSpaces(byUser)).toBe(live);
    expect(streamingSpaces({ ...byUser })).not.toBe(live);
  });

  it('names the activity for the tile’s accessible name', () => {
    expect(activityWords({ voice: true, live: true, event: true })).toEqual(['in voice', 'live', 'event happening now']);
    expect(activityWords({ voice: false, live: false, event: false })).toEqual([]);
  });
});
