import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from '../sections';
import { SETTINGS_NAV, filterSettingsNav, matchesSettingsItem } from './navModel';

const labels = (groups = SETTINGS_NAV) => groups.map((g) => [g.title, g.items.map((i) => i.label)]);

describe('User Settings nav', () => {
  it('groups the existing sections the Discord way, Keybinds and a red Log Out included', () => {
    expect(labels()).toEqual([
      ['User Settings', ['My Account', 'Profiles', 'Privacy & Safety', 'Devices']],
      [
        'App Settings',
        ['Chats', 'Voice & Video', 'Notifications', 'Keybinds', 'Storage & Data', 'Streamer Mode'],
      ],
      [null, ['Help', 'Log Out']],
    ]);
    const logout = SETTINGS_NAV[2]!.items[1]!;
    expect(logout).toMatchObject({ action: 'logout', danger: true });
    expect(SETTINGS_NAV[1]!.items[3]).toMatchObject({ key: 'keybinds', action: 'keybinds' });
    expect(SETTINGS_NAV[0]!.items[0]).toMatchObject({ key: 'account', to: '/settings/account' });
  });

  it('lists every settings section exactly once', () => {
    const keys = SETTINGS_NAV.flatMap((g) => g.items.filter((i) => i.to).map((i) => i.key));
    expect([...keys].sort()).toEqual(SETTINGS_SECTIONS.map((s) => s.id).sort());
  });
});

describe('settings search', () => {
  it('matches labels and keywords, ignoring case and accents', () => {
    expect(labels(filterSettingsNav('wallpaper'))).toEqual([['App Settings', ['Chats']]]);
    expect(labels(filterSettingsNav('BLOCKED'))).toEqual([['User Settings', ['Privacy & Safety']]]);
    expect(labels(filterSettingsNav('appearance'))).toEqual([['App Settings', ['Chats']]]);
    // The Help page lists the shortcuts too.
    expect(labels(filterSettingsNav('shortcuts'))).toEqual([
      ['App Settings', ['Keybinds']],
      [null, ['Help']],
    ]);
    expect(labels(filterSettingsNav('  Prívacy '))).toEqual([
      ['User Settings', ['Privacy & Safety']],
    ]);
  });

  it('needs every word of the query', () => {
    expect(labels(filterSettingsNav('noise canc'))).toEqual([['App Settings', ['Voice & Video']]]);
    expect(filterSettingsNav('noise wallpaper')).toEqual([]);
  });

  it('keeps only the groups with matches, and everything for an empty query', () => {
    const logOut = filterSettingsNav('log out');
    expect(labels(logOut)).toEqual([
      ['User Settings', ['My Account']],
      [null, ['Log Out']],
    ]);
    expect(filterSettingsNav('   ')).toEqual(SETTINGS_NAV);
    expect(filterSettingsNav('zzzz')).toEqual([]);
  });

  it('matchesSettingsItem treats an empty query as a match', () => {
    expect(matchesSettingsItem(SETTINGS_NAV[0]!.items[0]!, '')).toBe(true);
  });
});
