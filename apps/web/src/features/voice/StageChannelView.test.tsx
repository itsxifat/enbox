/**
 * The Stage view per role (stores set up, the voice engine mocked): the audience asks to speak
 * and leaves quietly, a speaker mutes and steps down, a moderator sees the raised hands and
 * invites people up, and moves them with the member menu; not connected, the lobby joins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type ChatSummary, type SpaceMember, type VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';

const engine = vi.hoisted(() => ({
  connectVoice: vi.fn(async () => undefined),
  disconnectVoice: vi.fn(async () => undefined),
  resumeVoiceAudio: vi.fn(async () => undefined),
  voiceAvailable: () => true,
}));
vi.mock('./engine', () => engine);

const { StageChannelView } = await import('./StageChannelView');

const STAGE = 'st1';
const LISTENER = PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK;
const MODERATOR = LISTENER | PERM.MUTE_MEMBERS | PERM.MOVE_MEMBERS;

function stageChat(bits: number): ChatSummary {
  const c = makeChat({ id: STAGE, name: 'Town Hall', type: 'space_stage', spacePermissions: bits });
  return {
    ...c,
    space: {
      spaceId: 's1',
      categoryId: null,
      position: 0,
      topic: 'Weekly questions',
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

const vs = (userId: string, p: Partial<VoiceState> = {}): VoiceState => ({
  userId,
  spaceId: 's1',
  channelId: STAGE,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  suppressed: true,
  requestToSpeakAt: null,
  joinedAt: '2026-10-23T10:00:00.000Z',
  ...p,
});

const member = (userId: string) =>
  ({ userId, nickname: null, roleIds: [], joinedAt: '2026-01-01T00:00:00.000Z', timedOutUntil: null }) as unknown as SpaceMember;

function setup(o: { bits: number; me?: Partial<VoiceState>; connected?: boolean }) {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.setState({
    byId: Object.fromEntries(
      ['me', 'ann', 'bob', 'cat'].map((id) => [id, makeUser({ id, displayName: id[0]!.toUpperCase() + id.slice(1) })]),
    ),
  });
  useSpaces.setState({ members: { s1: Object.fromEntries(['me', 'ann', 'bob', 'cat'].map((id) => [id, member(id)])) } });
  useVoice.setState({
    connection: o.connected === false ? null : { spaceId: 's1', channelId: STAGE, status: 'connected' },
    loadedSpaces: { s1: true },
    // Join order: Ann (on stage), me, Bob (hand raised), Cat.
    byUser: {
      ...(o.connected === false ? {} : { me: vs('me', o.me) }),
      ann: vs('ann', { suppressed: false, joinedAt: '2026-10-23T09:00:00.000Z' }),
      bob: vs('bob', { requestToSpeakAt: '2026-10-23T10:05:00.000Z', joinedAt: '2026-10-23T10:01:00.000Z' }),
      cat: vs('cat', { joinedAt: '2026-10-23T10:02:00.000Z' }),
    },
  });
  const chat = stageChat(o.bits);
  render(
    <MemoryRouter>
      <StageChannelView chat={chat} space={makeSpace()} />
    </MemoryRouter>,
  );
  return chat;
}

/** The PATCH answers with the state the client shows (the optimistic one). */
function patchEchoes() {
  return vi.spyOn(api, 'patch').mockImplementation((async (path: string) => {
    const id = path.endsWith('/@me') ? 'me' : path.split('/voice-states/')[1]!.split('/')[0]!;
    return useVoice.getState().byUser[id];
  }) as never);
}

const names = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))
    .filter(Boolean);

describe('StageChannelView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    vi.spyOn(api, 'post').mockResolvedValue([] as never);
  });
  afterEach(() => {
    useVoice.setState({ connection: null, byUser: {}, loadedSpaces: {} });
    useVoiceSelf.setState({ muted: false, deafened: false });
  });

  it('audience: the Stage, its speakers and audience (hands shown); Request to Speak and Leave Quietly', async () => {
    setup({ bits: LISTENER });
    expect(screen.getByRole('heading', { level: 1, name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByTestId('stage-topic')).toHaveTextContent('Weekly questions');
    expect(names(screen.getByRole('region', { name: 'Speakers' }))).toEqual(['Ann']);
    expect(names(screen.getByRole('region', { name: 'Audience' }))).toEqual(['Me', 'Bob, asked to speak', 'Cat']);
    expect(screen.getAllByTestId('raised-hand')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Requests to speak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move to Audience' })).toBeNull();

    const patch = patchEchoes();
    const ask = screen.getByRole('button', { name: 'Request to Speak' });
    expect(ask).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(ask);
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/voice-states/@me', { requestToSpeak: true });
    expect(await screen.findByRole('button', { name: 'Hand Raised' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Hand Raised' }));
    expect(patch).toHaveBeenLastCalledWith('/api/spaces/s1/voice-states/@me', { requestToSpeak: false });

    fireEvent.click(screen.getByRole('button', { name: 'Leave Quietly' }));
    expect(engine.disconnectVoice).toHaveBeenCalled();
  });

  it('speaker: the mic toggle and Move to Audience', async () => {
    setup({ bits: LISTENER, me: { suppressed: false } });
    expect(names(screen.getByRole('region', { name: 'Speakers' }))).toEqual(['Ann', 'Me']);
    expect(screen.queryByRole('button', { name: 'Request to Speak' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(useVoiceSelf.getState().muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();

    const patch = patchEchoes();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Audience' }));
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/voice-states/me/stage', { suppressed: true });
    // Shown at once: I am back in the audience.
    expect(await screen.findByRole('button', { name: 'Request to Speak' })).toBeInTheDocument();
  });

  it('moderator: the raised hands with Invite to Speak, Become a Speaker, and the member menu', async () => {
    setup({ bits: MODERATOR });
    const requests = screen.getByRole('region', { name: 'Requests to speak' });
    expect(within(requests).getByText('Bob')).toBeInTheDocument();
    expect(within(requests).queryByText('Cat')).toBeNull();
    expect(screen.getByRole('button', { name: 'Become a Speaker' })).toBeInTheDocument();

    const patch = patchEchoes();
    fireEvent.click(within(requests).getByRole('button', { name: 'Invite to Speak' }));
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/voice-states/bob/stage', { suppressed: false });
    expect(names(screen.getByRole('region', { name: 'Speakers' }))).toEqual(['Ann', 'Bob']);
    expect(within(screen.getByRole('region', { name: 'Requests to speak' })).getByText(/no one has asked/i)).toBeInTheDocument();

    // Right-click a speaker: Move to Audience; an audience member: Invite to Speak.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Ann' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Audience' }));
    expect(patch).toHaveBeenLastCalledWith('/api/spaces/s1/voice-states/ann/stage', { suppressed: true });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cat' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Invite to Speak' }));
    expect(patch).toHaveBeenLastCalledWith('/api/spaces/s1/voice-states/cat/stage', { suppressed: false });

    fireEvent.click(screen.getByRole('button', { name: 'Become a Speaker' }));
    expect(patch).toHaveBeenLastCalledWith('/api/spaces/s1/voice-states/me/stage', { suppressed: false });
  });

  it('a non-moderator’s member menu has only the profile', async () => {
    setup({ bits: LISTENER });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Ann' }));
    expect(await screen.findByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to Audience' })).toBeNull();
  });

  it('a refused request is put back', async () => {
    setup({ bits: LISTENER });
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('nope'));
    fireEvent.click(screen.getByRole('button', { name: 'Request to Speak' }));
    expect(await screen.findByRole('button', { name: 'Request to Speak' })).toHaveAttribute('aria-pressed', 'false');
    expect(useVoice.getState().byUser.me?.requestToSpeakAt).toBeNull();
  });

  it('not connected: the lobby counts speakers and listeners and joins as a listener', () => {
    const chat = setup({ bits: LISTENER, connected: false });
    expect(screen.getByTestId('stage-counts')).toHaveTextContent('1 speaker · 2 listening');
    fireEvent.click(screen.getByRole('button', { name: 'Join Stage' }));
    expect(engine.connectVoice).toHaveBeenCalledWith(chat);
  });
});
