/**
 * Friend-online alerts (Friends ▸ settings, the `friendOnlineAlerts` device pref): a toast
 * "Ann is online" when a friend goes from offline to online. Never for what we learn first or
 * resync (the initial load, a friend just added, the presence a reconnect brings back), at most
 * one per friend per ONLINE_ALERT_COOLDOWN_MS, and none while I'm in Do Not Disturb. While on,
 * the friends' presence is subscribed app-wide (presence comes per subscription).
 */
import { useEffect, useMemo } from 'react';
import { isDnd, userDisplayName, type ID } from '@enbox/shared';
import { useConnection } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useContactList } from '@/stores/contacts';
import { toast, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';

export const ONLINE_ALERT_COOLDOWN_MS = 10 * 60_000;
/** After a (re)connect the subscriptions are re-sent: their answers are not news. */
export const RESYNC_QUIET_MS = 5_000;

/**
 * Who just came online, from successive snapshots of the friends' `online` (null = unknown or
 * hidden). Pure state, unit-tested.
 */
export function createOnlineAlerter(cooldownMs = ONLINE_ALERT_COOLDOWN_MS) {
  /** The last online state seen per friend (unknown ones are absent). */
  const seen = new Map<ID, boolean>();
  const alertedAt = new Map<ID, number>();
  let quietUntil = 0;
  return {
    update(online: ReadonlyMap<ID, boolean | null>, now = Date.now()): ID[] {
      const out: ID[] = [];
      const quiet = now < quietUntil;
      for (const [id, value] of online) {
        if (value === null) continue;
        const before = seen.get(id);
        seen.set(id, value);
        if (quiet || before !== false || !value) continue;
        const last = alertedAt.get(id);
        if (last !== undefined && now - last < cooldownMs) continue;
        alertedAt.set(id, now);
        out.push(id);
      }
      // No longer a friend: start over if they come back.
      for (const id of seen.keys()) if (!online.has(id)) seen.delete(id);
      return out;
    },
    /** Only record (no alerts) until `until` (epoch ms; Infinity while disconnected). */
    quiet(until: number) {
      quietUntil = until;
    },
  };
}

function Watcher() {
  const { items } = useContactList();
  const ids = useMemo(() => items.map((i) => i.user.id), [items]);
  const alerter = useMemo(() => createOnlineAlerter(), []);

  useEffect(() => {
    if (!ids.length) return;
    const { subscribePresence, unsubscribePresence } = useUsers.getState();
    void subscribePresence(ids);
    return () => unsubscribePresence(ids);
  }, [ids]);

  useEffect(() => {
    const quietFor = (ready: boolean) =>
      alerter.quiet(ready ? Date.now() + RESYNC_QUIET_MS : Number.POSITIVE_INFINITY);
    const check = () => {
      const { presence, byId } = useUsers.getState();
      const online = new Map(ids.map((id) => [id, presence[id]?.online ?? null] as const));
      const came = alerter.update(online);
      const me = useAuth.getState().user;
      if (me && isDnd(me)) return;
      for (const id of came)
        toast.info(`${userDisplayName(byId[id])} is online`, { id: `friend-online:${id}` });
    };
    if (!useConnection.getState().ready) quietFor(false);
    check();
    const offPresence = useUsers.subscribe((s, prev) => {
      if (s.presence !== prev.presence) check();
    });
    const offConnection = useConnection.subscribe((s, prev) => {
      if (s.ready !== prev.ready) quietFor(s.ready);
    });
    return () => {
      offPresence();
      offConnection();
    };
  }, [ids, alerter]);

  return null;
}

/** Mounted once (UserMenuHost): watches while the pref is on. */
export function FriendOnlineAlerts() {
  const on = useUi((s) => s.prefs.friendOnlineAlerts);
  return on ? <Watcher /> : null;
}
