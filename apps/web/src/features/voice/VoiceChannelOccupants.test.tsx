import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PERM, type ChatSummary, type VoiceState } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useVoice } from '@/stores/voice';
import { makeChat, makeMe } from '@/test/factories';
import { VoiceChannelOccupants, occupantMenuItems } from './VoiceChannelOccupants';

const MOVE = PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.MOVE_MEMBERS;

function voiceChannel(id: string, name: string, bits: number, type: ChatSummary['type'] = 'space_voice'): ChatSummary {
  const c = makeChat({ id, name, type, spacePermissions: bits });
  return {
    ...c,
    space: {
      spaceId: 's1',
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

const state: VoiceState = {
  userId: 'bob',
  spaceId: 's1',
  channelId: 'v1',
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
};

const v1 = voiceChannel('v1', 'General', MOVE);
const lounge = voiceChannel('v2', 'Lounge', MOVE);
const locked = voiceChannel('v3', 'Locked', PERM.VIEW_CHANNEL | PERM.MOVE_MEMBERS);
const stage = voiceChannel('v4', 'Stage', PERM.VIEW_CHANNEL | PERM.CONNECT);
const text = voiceChannel('t1', 'chat', MOVE, 'space_text');
const all = [text, v1, lounge, locked, stage];

/** Labels of a menu (submenus as "Label ▸ a | b"). */
function labels(items: MenuEntry[]): string[] {
  return items
    .filter((e): e is Exclude<MenuEntry, null | false | undefined> => !!e)
    .map((e) =>
      e === 'separator'
        ? '—'
        : `${String(e.label)}${e.disabled ? ' (disabled)' : ''}${e.submenu ? ` ▸ ${labels(e.submenu).join(' | ')}` : ''}`,
    );
}

const noop = () => undefined;

describe('occupant menu', () => {
  it('with MOVE_MEMBERS: Move To lists the other voice channels I can connect to and move into, and Disconnect', () => {
    const items = occupantMenuItems({ state, channel: v1, channels: all, onProfile: noop, onMove: noop, onDisconnect: noop });
    expect(labels(items)).toEqual(['Profile', '—', 'Move To ▸ Lounge', 'Disconnect']);
  });

  it('without MOVE_MEMBERS in their channel: only the profile', () => {
    const items = occupantMenuItems({
      state,
      channel: { spacePermissions: PERM.VIEW_CHANNEL | PERM.CONNECT },
      channels: all,
      onProfile: noop,
      onMove: noop,
      onDisconnect: noop,
    });
    expect(labels(items)).toEqual(['Profile']);
  });

  it('Stages: offered as Move To targets; their moderators get the seat actions', () => {
    const town = voiceChannel('v5', 'Town Hall', MOVE, 'space_stage');
    const listener = { ...state, channelId: 'v5', suppressed: true };
    const stage = { moderator: true, self: false, onInvite: noop, onAudience: noop };
    expect(labels(occupantMenuItems({ state, channel: v1, channels: [...all, town], onProfile: noop, onMove: noop, onDisconnect: noop }))).toEqual([
      'Profile',
      '—',
      'Move To ▸ Lounge | Town Hall',
      'Disconnect',
    ]);
    expect(
      labels(occupantMenuItems({ state: listener, channel: town, channels: [], onProfile: noop, onMove: noop, onDisconnect: noop, stage })),
    ).toEqual(['Profile', '—', 'Invite to Speak', '—', 'Move To ▸ No other voice channels (disabled)', 'Disconnect']);
    expect(
      labels(
        occupantMenuItems({
          state: { ...listener, suppressed: false },
          channel: { spacePermissions: PERM.VIEW_CHANNEL },
          channels: [],
          onProfile: noop,
          onMove: noop,
          onDisconnect: noop,
          stage: { ...stage, moderator: false, self: true },
        }),
      ),
    ).toEqual(['Profile', '—', 'Move to Audience']);
  });

  it('no other voice channel: Move To says so', () => {
    const items = occupantMenuItems({ state, channel: v1, channels: [v1, text], onProfile: noop, onMove: noop, onDisconnect: noop });
    expect(labels(items)).toEqual(['Profile', '—', 'Move To ▸ No other voice channels (disabled)', 'Disconnect']);
  });
});

describe('VoiceChannelOccupants', () => {
  beforeEach(() => {
    // The menu of someone else is a popover (its slider), which watches its size.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useVoice.setState({ byUser: { bob: state }, loadedSpaces: { s1: true } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useVoice.setState({ byUser: {}, loadedSpaces: {} });
    useUi.setState({ prefs: DEFAULT_PREFS });
  });

  it('right-click → Move To → a channel moves them (at once, then the server)', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue([] as never);
    render(<VoiceChannelOccupants chat={v1} channels={all} />);
    fireEvent.contextMenu(screen.getByTestId('voice-occupant'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move To' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Lounge' }));
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/voice-states/bob/move', { channelId: 'v2' });
    expect(useVoice.getState().byUser.bob?.channelId).toBe('v2');
    expect(screen.queryByTestId('voice-occupant')).toBeNull();
  });

  it('Disconnect calls the moderator route', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue([] as never);
    render(<VoiceChannelOccupants chat={v1} channels={all} />);
    fireEvent.contextMenu(screen.getByTestId('voice-occupant'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/voice-states/bob/disconnect');
  });

  it('User Volume and Mute (for me only) in their menu, kept on this device; the row shows it', async () => {
    render(<VoiceChannelOccupants chat={v1} channels={all} />);
    fireEvent.contextMenu(screen.getByTestId('voice-occupant'));
    const slider = await screen.findByRole('slider', { name: 'User Volume' });
    expect(slider).toHaveValue('100');
    expect(slider).toHaveAttribute('max', '200');
    fireEvent.change(slider, { target: { value: '150' } });
    expect(useUi.getState().prefs.userAudio.bob).toEqual({ volume: 1.5 });
    expect(slider).toHaveAttribute('aria-valuetext', '150%');

    const mute = screen.getByRole('menuitemcheckbox', { name: 'Mute' });
    expect(mute).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(mute);
    expect(useUi.getState().prefs.userAudio.bob).toEqual({ volume: 1.5, muted: true });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Mute' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('muted-for-me')).toBeInTheDocument();
    expect(screen.getByTestId('voice-occupant')).toHaveAccessibleName(/muted for you/);
    // The rest of the menu is still there.
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('my own row has no volume or mute', async () => {
    useVoice.setState({ byUser: { me: { ...state, userId: 'me' } } });
    render(<VoiceChannelOccupants chat={v1} channels={all} />);
    fireEvent.contextMenu(screen.getByTestId('voice-occupant'));
    expect(await screen.findByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'User Volume' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Mute' })).toBeNull();
  });

  it('a refused move puts them back', async () => {
    vi.spyOn(api, 'post').mockImplementation((async (path: string) => {
      if (path.endsWith('/move')) throw new Error('nope');
      return [];
    }) as never);
    render(<VoiceChannelOccupants chat={v1} channels={all} />);
    fireEvent.contextMenu(screen.getByTestId('voice-occupant'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move To' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Lounge' }));
    expect(await screen.findByTestId('voice-occupant')).toBeInTheDocument();
    expect(useVoice.getState().byUser.bob?.channelId).toBe('v1');
  });
});
