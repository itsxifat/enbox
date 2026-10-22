/**
 * The cosmetics render sweep: decorations, nameplates, name styles and role icons where users
 * appear (message rows, member list, DM rows, friends, the user panel, voice tiles).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Track, type Participant } from 'livekit-client';
import type { NameStyle, SpaceMember, SpaceRole } from '@enbox/shared';
import { UserPanel } from '@/components/layout/UserPanel';
import { SenderAvatar, SenderName } from '@/features/conversation/MessageRow';
import { FriendRow } from '@/features/home/FriendsPage';
import { DmRow } from '@/features/home/HomeSidebar';
import { MemberRow } from '@/features/spaces/MemberList';
import { makeSpace } from '@/features/spaces/testUtils';
import { Tile } from '@/features/voice/VoiceChannelView';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { preloadDecorationArt } from './AvatarDecoration';

beforeAll(() => preloadDecorationArt());

const STYLE: NameStyle = { font: 'pixel', effect: 'gradient', colors: ['#ff0000', '#0000ff'] };

const ada = makeUser({
  id: 'u-ada',
  displayName: 'Ada',
  avatarDecoration: 'halo',
  nameplate: 'galaxy',
  nameStyle: STYLE,
});

const ROLE: SpaceRole = {
  id: 'r-mod',
  name: 'Mods',
  color: '#ff0000',
  colorSecondary: '#00ff00',
  colorStyle: 'gradient',
  position: 2,
  permissions: 0,
  hoist: false,
  mentionable: false,
  isDefault: false,
  iconEmoji: '🛡️',
};

const space = makeSpace({ id: 's1', roles: [...makeSpace().roles, ROLE] });

function member(p: Partial<SpaceMember> = {}): SpaceMember {
  return {
    userId: ada.id,
    nickname: null,
    roleIds: [],
    joinedAt: '2026-01-01T00:00:00.000Z',
    timedOutUntil: null,
    serverMute: false,
    serverDeaf: false,
    ...p,
  };
}

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS });
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Mia' }) });
  useUsers.setState({
    byId: { [ada.id]: ada },
    presence: {},
    subscribePresence: async () => undefined,
    unsubscribePresence: () => undefined,
    fetchUsers: async () => undefined,
  });
  useSpaces.setState({ byId: { s1: space }, members: { s1: { [ada.id]: member() } } });
});

const deco = (el: Element = document.body) => el.querySelector('svg[data-decoration]')?.getAttribute('data-decoration');
const plate = (el: Element = document.body) => el.querySelector('[data-nameplate]')?.getAttribute('data-nameplate');
const styled = (el: Element = document.body) => el.querySelector('.cos-name') as HTMLElement;

describe('member list rows', () => {
  it('wear the decoration, the nameplate and the full name style', () => {
    render(<MemberRow space={space} member={member()} onMenu={() => undefined} />);
    const row = screen.getByTestId('space-member-row');
    expect(row).toHaveAttribute('data-animate-avatars');
    expect(deco(row)).toBe('halo');
    expect(plate(row)).toBe('galaxy');
    // The plate is first, so the positioned content paints over it.
    expect(row.firstElementChild).toHaveAttribute('data-nameplate', 'galaxy');
    expect(styled(row)).toHaveAttribute('data-font', 'pixel');
    expect(styled(row)).toHaveAttribute('data-effect', 'gradient');
  });

  it('per-Space overrides win; the top role styles the name and shows its icon', () => {
    render(
      <MemberRow
        space={space}
        member={member({ roleIds: [ROLE.id], nickname: 'Countess', avatarDecoration: 'crown', nameplate: 'lava' })}
        onMenu={() => undefined}
      />,
    );
    const row = screen.getByTestId('space-member-row');
    expect(deco(row)).toBe('crown');
    expect(plate(row)).toBe('lava');
    const n = styled(row);
    expect(n).toHaveTextContent('Countess');
    expect(n).toHaveAttribute('data-role', 'gradient');
    expect(n).toHaveAttribute('data-font', 'pixel');
    expect(n).not.toHaveAttribute('data-effect');
    expect(screen.getByRole('img', { name: 'Mods' })).toHaveTextContent('🛡️');
  });

  it('a plain member has none', () => {
    useUsers.setState({ byId: { [ada.id]: makeUser({ id: ada.id, displayName: 'Ada' }) } });
    render(<MemberRow space={space} member={member()} onMenu={() => undefined} />);
    const row = screen.getByTestId('space-member-row');
    expect(deco(row)).toBeUndefined();
    expect(plate(row)).toBeUndefined();
  });
});

describe('message rows', () => {
  it('the sender name wears the font only, the role colours and the role icon in a Space', () => {
    useSpaces.setState({ members: { s1: { [ada.id]: member({ roleIds: [ROLE.id] }) } } });
    render(<SenderName userId={ada.id} selecting={false} spaceId="s1" />);
    const n = styled();
    expect(n).toHaveAttribute('data-font', 'pixel');
    expect(n).not.toHaveAttribute('data-effect');
    expect(n).toHaveAttribute('data-role', 'gradient');
    const button = screen.getByRole('button', { name: 'Profile of Ada' });
    expect(button).toContainElement(screen.getByRole('img', { name: 'Mods' }));
  });

  it('outside a Space the name wears the font only', () => {
    render(<SenderName userId={ada.id} selecting={false} coloured />);
    expect(styled()).toHaveAttribute('data-font', 'pixel');
    expect(styled()).not.toHaveAttribute('data-effect');
    expect(styled()).not.toHaveAttribute('data-role');
  });

  it("my own name uses my style", () => {
    useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Mia', nameStyle: { font: 'cinzel', effect: 'solid', colors: ['#ffffff'] } }) });
    render(<SenderName userId="me" selecting={false} you="Mia" />);
    expect(styled()).toHaveTextContent('Mia');
    expect(styled()).toHaveAttribute('data-font', 'cinzel');
  });

  it('the sender avatar wears the decoration, the per-Space one in a Space', () => {
    const { unmount } = render(<SenderAvatar userId={ada.id} selecting={false} />);
    expect(deco()).toBe('halo');
    unmount();
    useSpaces.setState({ members: { s1: { [ada.id]: member({ avatarDecoration: 'wings' }) } } });
    render(<SenderAvatar userId={ada.id} selecting={false} spaceId="s1" />);
    expect(deco()).toBe('wings');
  });
});

describe('DM rows', () => {
  it("wear the peer's nameplate, decoration and name style", () => {
    const chat = makeChat({ id: 'c1', type: 'direct', name: null, peer: ada });
    render(
      <MemoryRouter>
        <DmRow chat={chat} active={false} />
      </MemoryRouter>,
    );
    const row = screen.getByTestId('dm-row');
    expect(row).toHaveAttribute('data-animate-avatars');
    expect(row.firstElementChild).toHaveAttribute('data-nameplate', 'galaxy');
    expect(deco(row)).toBe('halo');
    expect(styled(row)).toHaveAttribute('data-effect', 'gradient');
    expect(styled(row)).toHaveTextContent('Ada');
  });

  it('groups have none', () => {
    const chat = makeChat({ id: 'c2', type: 'group', name: 'Crew' });
    render(
      <MemoryRouter>
        <DmRow chat={chat} active={false} />
      </MemoryRouter>,
    );
    const row = screen.getByTestId('dm-row');
    expect(deco(row)).toBeUndefined();
    expect(plate(row)).toBeUndefined();
  });
});

describe('friends, user panel and voice', () => {
  it('friend rows wear the decoration and the name style', () => {
    render(
      <MemoryRouter>
        <FriendRow user={ada} state="online" onMenu={() => undefined} />
      </MemoryRouter>,
    );
    const row = screen.getByTestId('friend-row');
    expect(row).toHaveAttribute('data-animate-avatars');
    expect(deco(row)).toBe('halo');
    expect(styled(row)).toHaveAttribute('data-font', 'pixel');
  });

  it('the user panel wears my decoration and name style', () => {
    useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Mia', avatarDecoration: 'cat-ears', nameStyle: STYLE }) });
    render(
      <MemoryRouter>
        <UserPanel />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('user-panel');
    expect(deco(panel)).toBe('cat-ears');
    expect(styled(panel)).toHaveAttribute('data-font', 'pixel');
  });

  it('voice tiles wear the (per-Space) decoration', () => {
    const participant = {
      identity: ada.id,
      isMicrophoneEnabled: true,
      getTrackPublication: () => undefined,
    } as unknown as Participant;
    const { unmount } = render(<Tile participant={participant} spaceId="s1" source={Track.Source.Camera} />);
    expect(deco(screen.getByTestId('voice-tile'))).toBe('halo');
    unmount();
    useSpaces.setState({ members: { s1: { [ada.id]: member({ avatarDecoration: 'equalizer' }) } } });
    render(<Tile participant={participant} spaceId="s1" source={Track.Source.Camera} />);
    expect(deco(screen.getByTestId('voice-tile'))).toBe('equalizer');
  });
});
