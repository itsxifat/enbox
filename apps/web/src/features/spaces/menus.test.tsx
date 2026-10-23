import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type Space, type SpaceMember } from '@enbox/shared';
import type { MenuEntry, MenuItem } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { MemberActionsMenu } from './MemberActions';
import { copyIdItem, tidy, useSpaceMenu } from './menus';
import { makeSpace } from './testUtils';

/** Labels of a menu (submenus as "Label ▸ [children]"), checkbox state as "[x]". */
function labels(items: MenuEntry[]): string[] {
  return items
    .filter((e): e is Exclude<MenuEntry, null | false | undefined> => !!e)
    .map((e) =>
      e === 'separator'
        ? '—'
        : `${String(e.label)}${e.checked !== undefined ? (e.checked ? ' [x]' : ' [ ]') : ''}${
            e.submenu ? ` ▸ ${labels(e.submenu).join(' | ')}` : ''
          }`,
    );
}

function menusOf(space: Space): { header: string[]; rail: string[] } {
  const out = { header: [] as string[], rail: [] as string[] };
  function Harness() {
    const m = useSpaceMenu(space);
    out.header = labels(m.headerItems());
    out.rail = labels(m.railItems());
    return null;
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return out;
}

const setDevMode = (on: boolean) => useUi.setState({ prefs: { ...DEFAULT_PREFS, developerMode: on } });

beforeEach(() => useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' }));
afterEach(() => {
  useAuth.setState({ user: null });
  setDevMode(false);
});

describe('Space menus', () => {
  it('a plain member sees what @everyone allows (no settings, no create)', () => {
    const { header, rail } = menusOf(
      makeSpace({ myPermissions: PERM.VIEW_CHANNEL | PERM.CREATE_INVITE | PERM.CHANGE_NICKNAME }),
    );
    expect(header).toEqual([
      'Invite People',
      '—',
      'Notification Settings',
      'Privacy Settings',
      '—',
      'Edit Per-server Profile',
      'Hide Muted Channels [ ]',
      '—',
      'Report Space',
      'Leave Space',
    ]);
    expect(rail[0]).toBe('Mark As Read');
    expect(rail).toContain(
      'Mute Space ▸ For 15 minutes | For 1 hour | For 3 hours | For 8 hours | For 24 hours | Until I turn it back on',
    );
    expect(rail).toContain(
      'Notification Settings ▸ All Messages [ ] | Only @mentions [x] | Nothing [ ] | — | Suppress @everyone and @here [ ] | Suppress All Role @mentions [ ] | — | More Notification Settings',
    );
    expect(rail.some((l) => l.startsWith('Space Settings') || l.startsWith('Create'))).toBe(false);
  });

  it('the owner gets settings sections and create items; a muted Space offers Unmute', () => {
    setDevMode(true);
    const { header, rail } = menusOf(
      makeSpace({ owner: true, me: { mutedUntil: '9999-12-31T23:59:59.000Z', hideMutedChannels: true, notifyLevel: 'all' } }),
    );
    expect(header.slice(0, 4)).toEqual(['Invite People', 'Space Settings', 'Create Channel', 'Create Category']);
    expect(header).toContain('Hide Muted Channels [x]');
    expect(rail).toContain('Unmute Space');
    expect(rail.find((l) => l.startsWith('Space Settings ▸'))).toBe(
      'Space Settings ▸ Overview | Safety Setup | AutoMod | Roles | Emoji | Stickers | Soundboard | Integrations | Reports | Space Template | Members | Invites | Bans | Audit Log | Community Overview | Onboarding | Welcome Screen',
    );
    expect(rail.find((l) => l.startsWith('Notification Settings'))).toMatch(/^Notification Settings ▸ All Messages \[x\]/);
    expect(rail).toEqual(expect.arrayContaining(['Create Channel', 'Create Category', 'Leave Space', 'Copy Space ID']));
    // Owners can't report their own Space.
    expect(rail).not.toContain('Report Space');
  });

  it('Copy Space ID ends both menus in Developer Mode only', () => {
    const space = makeSpace({ myPermissions: PERM.VIEW_CHANNEL });
    const off = menusOf(space);
    expect(off.header).not.toContain('Copy Space ID');
    expect(off.rail).not.toContain('Copy Space ID');
    setDevMode(true);
    const on = menusOf(space);
    expect(on.header.slice(-2)).toEqual(['—', 'Copy Space ID']);
    expect(on.rail.slice(-2)).toEqual(['—', 'Copy Space ID']);
  });
});

describe('copyIdItem (channel, category and member menus)', () => {
  it('is hidden until Developer Mode is on, then copies the id', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(copyIdItem('c1', 'Channel')).toBe(false);
    setDevMode(true);
    const item = copyIdItem('c1', 'Channel') as MenuItem;
    expect(item.label).toBe('Copy Channel ID');
    item.onSelect!();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('c1'));
    expect(labels(tidy([{ label: 'Delete Category' }, 'separator', copyIdItem('k1', 'Category')]))).toEqual([
      'Delete Category',
      '—',
      'Copy Category ID',
    ]);
  });

  it('the member menu ends with Copy User ID in Developer Mode', () => {
    const member = { userId: 'u2', nickname: null, roleIds: [], joinedAt: '2026-01-01T00:00:00.000Z', timedOutUntil: null } as unknown as SpaceMember;
    const space = makeSpace({ myPermissions: PERM.VIEW_CHANNEL });
    const items = () => screen.getAllByRole('menuitem').map((i) => i.textContent);
    const { unmount } = render(<MemberActionsMenu space={space} member={member} anchor={{ x: 0, y: 0 }} onClose={() => {}} />);
    expect(items()).toEqual(['Profile']);
    unmount();
    setDevMode(true);
    render(<MemberActionsMenu space={space} member={member} anchor={{ x: 0, y: 0 }} onClose={() => {}} />);
    expect(items()).toEqual(['Profile', 'Copy User ID']);
  });
});

describe('tidy', () => {
  it('drops leading, trailing and doubled separators and hidden items', () => {
    expect(labels(tidy(['separator', false, { label: 'A' }, 'separator', null, 'separator', { label: 'B' }, 'separator']))).toEqual([
      'A',
      '—',
      'B',
    ]);
  });
});
