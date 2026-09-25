import { describe, expect, it } from 'vitest';
import { IN_APP_NAV, backTarget } from './navigation';
import { tabBadgeText } from './useTabBadges';

describe('header Back arrow', () => {
  it('goes back in history for pages opened by an in-app link', () => {
    expect(backTarget(IN_APP_NAV, { idx: 3 }, '/chats')).toEqual({ kind: 'pop' });
  });

  it('replaces the entry with the parent for deep links and untagged pages', () => {
    expect(backTarget(null, { idx: 3 }, '/chats')).toEqual({ kind: 'replace', to: '/chats' });
    // First entry of the tab (a notification / deep link): nothing to go back to.
    expect(backTarget(IN_APP_NAV, { idx: 0 }, '/updates')).toEqual({
      kind: 'replace',
      to: '/updates',
    });
    expect(backTarget(IN_APP_NAV, null, '/calls')).toEqual({ kind: 'replace', to: '/calls' });
  });
});

describe('tabBadgeText', () => {
  it('names each badge for what it counts', () => {
    expect(tabBadgeText('chats', { count: 1 })).toBe('1 unread chat');
    expect(tabBadgeText('chats', { count: 3 })).toBe('3 unread chats');
    expect(tabBadgeText('calls', { count: 2 })).toBe('2 missed calls');
    expect(tabBadgeText('calls', { count: 1 })).toBe('1 missed call');
    expect(tabBadgeText('updates', { dot: true })).toBe('new updates');
    expect(tabBadgeText('settings', undefined)).toBeNull();
  });
});
