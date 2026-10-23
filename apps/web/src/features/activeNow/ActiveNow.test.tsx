/**
 * Active Now (the API mocked, the voice engine faked): Discord's empty state; a card per
 * channel with the Space, the channel (Stages say so), LIVE while someone streams, my friends'
 * names, the people there with "+N"; Join Voice connects (loading the Space's channels first
 * when needed), the card opens the channel; voice changes of a friend or in a shown channel
 * refetch once, others do not.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { PERM, type FriendActivity, type VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeSpace } from '@/features/spaces/testUtils';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { useVoice } from '@/stores/voice';
import { makeChat, makeMe, makeUser } from '@/test/factories';

const engine = vi.hoisted(() => ({ connectVoice: vi.fn(async () => undefined) }));
vi.mock('@/features/voice/engine', () => engine);

const { ActiveNow } = await import('./ActiveNow');
const { ACTIVITY_REFRESH_MS } = await import('./store');

const lounge: FriendActivity = {
  spaceId: 's1',
  spaceName: 'Gaming Lounge',
  spaceIconUrl: null,
  channelId: 'v1',
  channelName: 'General',
  channelType: 'space_voice',
  friendIds: ['ann', 'bob'],
  participantIds: ['ann', 'bob', 'cy', 'dee', 'eve', 'fay', 'gus', 'hal'],
  participantCount: 9,
  streaming: true,
  since: '2026-10-23T10:00:00.000Z',
};
const townHall: FriendActivity = {
  spaceId: 's2',
  spaceName: 'Book Club',
  spaceIconUrl: null,
  channelId: 'st1',
  channelName: 'Town Hall',
  channelType: 'space_stage',
  friendIds: ['ann'],
  participantIds: ['ann'],
  participantCount: 1,
  streaming: false,
  since: '2026-10-23T11:00:00.000Z',
};

let activity: FriendActivity[];
let get: MockInstance<typeof api.get>;

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname}</span>;
}

function renderColumn() {
  return render(
    <MemoryRouter initialEntries={['/chats']}>
      <ActiveNow />
      <Where />
    </MemoryRouter>,
  );
}

const vs = (userId: string, channelId: string): VoiceState => ({
  userId,
  spaceId: 's1',
  channelId,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
});
const voiceChange = (state: VoiceState) =>
  act(() => useVoice.getState().applyState({ ...state, state }));

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.setState({
    byId: Object.fromEntries(
      ['ann', 'bob', 'cy', 'dee', 'eve', 'fay', 'gus', 'hal'].map((id) => [
        id,
        makeUser({ id, displayName: id[0]!.toUpperCase() + id.slice(1) }),
      ]),
    ),
    fetchUsers: async () => undefined,
  });
  useContacts.setState({
    contacts: ['ann', 'bob'].map((userId) => ({
      userId,
      name: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    loaded: true,
  });
  activity = [lounge, townHall];
  get = vi
    .spyOn(api, 'get')
    .mockImplementation((path: string) =>
      path === '/api/me/friends/activity'
        ? Promise.resolve(structuredClone(activity) as never)
        : Promise.reject(new Error(`unexpected GET ${path}`)),
    );
  engine.connectVoice.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  useVoice.setState({ byUser: {}, connection: null });
});

describe('Active Now', () => {
  it('nothing going on: it is quiet for now', async () => {
    activity = [];
    renderColumn();
    expect(screen.getByRole('heading', { name: 'Active Now' })).toBeInTheDocument();
    expect(await screen.findByText('It’s quiet for now…')).toBeInTheDocument();
    expect(
      screen.getByText(
        'When a friend starts an activity, like hanging out in voice, we’ll show it here!',
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('activity-card')).toHaveLength(0);
  });

  it('a card per channel: the Space, the channel, LIVE, my friends, the people there and +N', async () => {
    renderColumn();
    const cards = await screen.findAllByTestId('activity-card');
    expect(cards).toHaveLength(2);
    const [voice, stage] = cards.map((c) => within(c));
    expect(voice!.getByText('Gaming Lounge')).toBeInTheDocument();
    expect(voice!.getByText('General')).toBeInTheDocument();
    expect(voice!.getByText('LIVE')).toBeInTheDocument();
    expect(voice!.getByTestId('activity-friends')).toHaveTextContent('Ann, Bob');
    // Five avatars of nine people.
    expect(
      voice!.getByRole('group', { name: '9 in voice' }).querySelectorAll('[title]'),
    ).toHaveLength(5);
    expect(voice!.getByTestId('activity-more')).toHaveTextContent('+4');
    expect(voice!.getByRole('button', { name: 'Join Voice' })).toBeEnabled();

    expect(stage!.getByText('Book Club')).toBeInTheDocument();
    expect(stage!.getByText('· Stage')).toBeInTheDocument();
    expect(stage!.queryByText('LIVE')).toBeNull();
    expect(stage!.queryByTestId('activity-more')).toBeNull();
    expect(stage!.getByRole('button', { name: 'Join Stage' })).toBeInTheDocument();
  });

  it('live names when the Space and channel are loaded; Join Voice connects; the card opens the channel', async () => {
    const chat = makeChat({
      id: 'v1',
      type: 'space_voice',
      name: 'Hangout',
      spacePermissions: PERM.VIEW_CHANNEL | PERM.CONNECT,
    });
    useChats.setState({ byId: { v1: chat } });
    useSpaces.setState({ byId: { s1: makeSpace({ id: 's1', name: 'Renamed Lounge' }) } });
    renderColumn();
    const [card] = await screen.findAllByTestId('activity-card');
    expect(within(card!).getByText('Renamed Lounge')).toBeInTheDocument();
    expect(within(card!).getByText('Hangout')).toBeInTheDocument();

    fireEvent.click(within(card!).getByRole('button', { name: 'Join Voice' }));
    await vi.waitFor(() => expect(engine.connectVoice).toHaveBeenCalledWith(chat));
    expect(screen.getByTestId('where')).toHaveTextContent('/chats');

    fireEvent.click(within(card!).getByRole('button', { name: 'Open Hangout in Renamed Lounge' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/v1');
  });

  it('joining a channel this session has not loaded loads its Space first; no CONNECT, no Join', async () => {
    const stage = makeChat({
      id: 'st1',
      type: 'space_stage',
      name: 'Town Hall',
      spacePermissions: PERM.VIEW_CHANNEL,
    });
    const loadSpace = vi.fn(async () => {
      useChats.setState({ byId: { st1: stage } });
      return null;
    });
    useSpaces.setState({ loadSpace });
    renderColumn();
    const cards = await screen.findAllByTestId('activity-card');
    fireEvent.click(within(cards[1]!).getByRole('button', { name: 'Join Stage' }));
    await vi.waitFor(() => expect(engine.connectVoice).toHaveBeenCalledWith(stage));
    expect(loadSpace).toHaveBeenCalledWith('s2');
    // Now the channel is known, and I may not connect there.
    expect(within(cards[1]!).getByRole('button', { name: 'Join Stage' })).toBeDisabled();
  });

  it('refetches once for voice changes of friends or in a shown channel, not for others', async () => {
    renderColumn();
    await screen.findAllByTestId('activity-card');
    expect(get).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();

    // A stranger elsewhere: nothing.
    voiceChange(vs('zed', 'elsewhere'));
    await act(() => vi.advanceTimersByTimeAsync(ACTIVITY_REFRESH_MS));
    expect(get).toHaveBeenCalledTimes(1);

    // A stranger joins a shown channel, then a friend moves: one request.
    voiceChange(vs('cy', 'v1'));
    voiceChange(vs('ann', 'elsewhere'));
    await act(() => vi.advanceTimersByTimeAsync(ACTIVITY_REFRESH_MS));
    expect(get).toHaveBeenCalledTimes(2);

    activity = [];
    voiceChange(vs('bob', 'v9'));
    await act(() => vi.advanceTimersByTimeAsync(ACTIVITY_REFRESH_MS));
    expect(get).toHaveBeenCalledTimes(3);
    expect(screen.getByText('It’s quiet for now…')).toBeInTheDocument();
  });
});
