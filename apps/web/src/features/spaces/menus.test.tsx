import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type Space } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { tidy, useSpaceMenu } from './menus';
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

beforeEach(() => useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' }));
afterEach(() => useAuth.setState({ user: null }));

describe('Space menus', () => {
  it('a plain member sees what @everyone allows (no settings, no create)', () => {
    const { header, rail } = menusOf(
      makeSpace({ myPermissions: PERM.VIEW_CHANNEL | PERM.CREATE_INVITE | PERM.CHANGE_NICKNAME }),
    );
    expect(header).toEqual([
      'Invite People',
      '—',
      'Notification Settings',
      '—',
      'Edit Per-server Profile',
      'Hide Muted Channels [ ]',
      '—',
      'Leave Space',
      '—',
      'Copy Space ID',
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
    const { header, rail } = menusOf(
      makeSpace({ owner: true, me: { mutedUntil: '9999-12-31T23:59:59.000Z', hideMutedChannels: true, notifyLevel: 'all' } }),
    );
    expect(header.slice(0, 4)).toEqual(['Invite People', 'Space Settings', 'Create Channel', 'Create Category']);
    expect(header).toContain('Hide Muted Channels [x]');
    expect(rail).toContain('Unmute Space');
    expect(rail.find((l) => l.startsWith('Space Settings ▸'))).toBe(
      'Space Settings ▸ Overview | Safety Setup | Roles | Emoji | Members | Invites | Bans | Audit Log',
    );
    expect(rail.find((l) => l.startsWith('Notification Settings'))).toMatch(/^Notification Settings ▸ All Messages \[x\]/);
    expect(rail).toEqual(expect.arrayContaining(['Create Channel', 'Create Category', 'Leave Space', 'Copy Space ID']));
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
