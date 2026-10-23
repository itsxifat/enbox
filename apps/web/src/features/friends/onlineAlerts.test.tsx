/**
 * Friend-online alerts: only a friend seen offline who comes online (never what loads first),
 * one per friend per 10 minutes, quiet while (re)connecting, nothing while the pref is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { ID } from '@enbox/shared';
import { useConnection } from '@/lib/socket';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useContacts } from '@/stores/contacts';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeUser } from '@/test/factories';
import { FriendOnlineAlerts, ONLINE_ALERT_COOLDOWN_MS, createOnlineAlerter } from './onlineAlerts';

const snap = (entries: [ID, boolean | null][]) => new Map(entries);

describe('createOnlineAlerter', () => {
  it('alerts offline → online only; what it learns first is never news', () => {
    const a = createOnlineAlerter();
    expect(
      a.update(
        snap([
          ['ann', true],
          ['bob', false],
        ]),
        0,
      ),
    ).toEqual([]);
    expect(
      a.update(
        snap([
          ['ann', true],
          ['bob', true],
        ]),
        1,
      ),
    ).toEqual(['bob']);
    // Online again without going offline: nothing.
    expect(
      a.update(
        snap([
          ['ann', true],
          ['bob', true],
        ]),
        2,
      ),
    ).toEqual([]);
  });

  it('at most one alert per friend per cooldown', () => {
    const a = createOnlineAlerter();
    a.update(snap([['bob', false]]), 0);
    expect(a.update(snap([['bob', true]]), 1)).toEqual(['bob']);
    a.update(snap([['bob', false]]), 2);
    expect(a.update(snap([['bob', true]]), ONLINE_ALERT_COOLDOWN_MS - 1)).toEqual([]);
    a.update(snap([['bob', false]]), ONLINE_ALERT_COOLDOWN_MS);
    expect(a.update(snap([['bob', true]]), ONLINE_ALERT_COOLDOWN_MS + 2)).toEqual(['bob']);
  });

  it('unknown (hidden) presence keeps the last state; a friend who left is forgotten', () => {
    const a = createOnlineAlerter();
    a.update(snap([['bob', false]]), 0);
    expect(a.update(snap([['bob', null]]), 1)).toEqual([]);
    expect(a.update(snap([['bob', true]]), 2)).toEqual(['bob']);
    const b = createOnlineAlerter();
    b.update(snap([['cy', false]]), 0);
    b.update(snap([]), 1);
    expect(b.update(snap([['cy', true]]), 2)).toEqual([]);
  });

  it('quiet: records without alerting', () => {
    const a = createOnlineAlerter();
    a.update(snap([['bob', false]]), 0);
    a.quiet(100);
    expect(a.update(snap([['bob', true]]), 50)).toEqual([]);
    a.update(snap([['bob', false]]), 60);
    expect(a.update(snap([['bob', true]]), 150)).toEqual(['bob']);
  });
});

describe('FriendOnlineAlerts', () => {
  const ann = makeUser({
    id: 'ann',
    displayName: 'Ann',
    isContact: true,
    online: false,
    presenceState: 'offline',
  });
  const presence = (online: boolean) =>
    act(() =>
      useUsers
        .getState()
        .setPresence({
          userId: 'ann',
          online,
          state: online ? 'online' : 'offline',
          note: null,
          lastSeenAt: null,
        }),
    );
  const toasts = () => useUi.getState().toasts.map((t) => t.message);

  beforeEach(() => {
    resetSessionState();
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useUi.setState({ toasts: [] });
    useUsers.getState().upsertUsers([ann]);
    useContacts.setState({
      contacts: [{ userId: 'ann', name: null, createdAt: '' }],
      loaded: true,
    });
    useConnection.setState({ ready: true });
    vi.spyOn(useUsers.getState(), 'subscribePresence').mockResolvedValue();
    vi.spyOn(useUsers.getState(), 'unsubscribePresence').mockReturnValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useUi.getState().setPref('friendOnlineAlerts', false);
    useConnection.setState({ ready: false });
  });

  it('toasts "Ann is online" when she comes online, and watches her presence', () => {
    useUi.getState().setPref('friendOnlineAlerts', true);
    render(<FriendOnlineAlerts />);
    expect(useUsers.getState().subscribePresence).toHaveBeenCalledWith(['ann']);
    expect(toasts()).toEqual([]);
    presence(true);
    expect(toasts()).toEqual(['Ann is online']);
  });

  it('nothing for who is online already when it starts', () => {
    useUsers.getState().upsertUsers([{ ...ann, online: true, presenceState: 'online' }]);
    useUi.getState().setPref('friendOnlineAlerts', true);
    render(<FriendOnlineAlerts />);
    presence(true);
    expect(toasts()).toEqual([]);
  });

  it('off by default', () => {
    render(<FriendOnlineAlerts />);
    presence(true);
    expect(toasts()).toEqual([]);
    expect(useUsers.getState().subscribePresence).not.toHaveBeenCalled();
  });

  it('quiet while the connection is down: the resynced presence is not news', () => {
    useUi.getState().setPref('friendOnlineAlerts', true);
    render(<FriendOnlineAlerts />);
    act(() => useConnection.setState({ ready: false }));
    presence(true);
    expect(toasts()).toEqual([]);
  });
});
