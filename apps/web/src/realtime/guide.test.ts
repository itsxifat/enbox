/** Realtime: `space:guide` replaces my copy's guide, `me:channel-prefs` my channel choices. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerGuide } from '@enbox/shared';
import { api } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { makeMe } from '@/test/factories';
import { seedSpace, spaceChannel } from '@/features/guide/testUtils';
import { setChannelsShown } from '@/features/guide/actions';
import { registerGuideHandlers } from './guide';

type Handler = (payload: never) => void;

function fakeSocket() {
  const handlers = new Map<string, Handler>();
  const socket = {
    on: (event: string, fn: Handler) => handlers.set(event, fn),
  } as unknown as AppSocket;
  registerGuideHandlers(socket);
  return (event: string, payload: unknown) => handlers.get(event)!(payload as never);
}

const guide: ServerGuide = {
  enabled: true,
  welcome: { title: 'Hi', subtitle: null },
  todos: [{ channelId: 'rules', emoji: null, description: 'Read' }],
  resources: [],
};

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  seedSpace({}, [
    spaceChannel('rules', 'rules'),
    spaceChannel('clubs', 'clubs', {}, { optIn: true }),
  ]);
});

describe('guide realtime', () => {
  it('space:guide sets or removes the guide of my Space', () => {
    const emit = fakeSocket();
    emit('space:guide', { spaceId: 's1', guide });
    expect(useSpaces.getState().byId.s1!.guide).toEqual(guide);
    emit('space:guide', { spaceId: 's1', guide: null });
    expect(useSpaces.getState().byId.s1!.guide).toBeNull();
    // Not one of my Spaces: nothing happens.
    emit('space:guide', { spaceId: 'other', guide });
    expect(useSpaces.getState().byId.other).toBeUndefined();
  });

  it('me:channel-prefs replaces my choices, keeping the ones not sent yet on top', () => {
    const emit = fakeSocket();
    emit('me:channel-prefs', { spaceId: 's1', prefs: [{ channelId: 'rules', shown: false }] });
    expect(useSpaces.getState().byId.s1!.me.channelPrefs).toEqual([
      { channelId: 'rules', shown: false },
    ]);
    vi.spyOn(api, 'put').mockResolvedValue([] as never);
    setChannelsShown('s1', { clubs: true });
    emit('me:channel-prefs', { spaceId: 's1', prefs: [] });
    expect(useSpaces.getState().byId.s1!.me.channelPrefs).toEqual([
      { channelId: 'clubs', shown: true },
    ]);
  });
});
