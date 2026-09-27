/**
 * Group/channel member lists: fetch `GET /api/chats/:id/members`, keep it fresh on
 * `chat:members-changed` (and reconnects), and sort WhatsApp-style (you, owner, admins, A→Z).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { userDisplayName } from '@enbox/shared';
import { useBus } from '@/hooks/useBus';
import { errorMessage } from '@/lib/api';
import { fetchMembers } from './shared/chatActions';

const ROLE_RANK = { owner: 0, admin: 1, member: 2 };

/** Me first, then owner, admins, members; alphabetical inside a role. Pure. */
export function sortMembers(members, meId) {
  return [...members].sort((a, b) => {
    if (a.user.id === meId) return -1;
    if (b.user.id === meId) return 1;
    const r = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (r) return r;
    return userDisplayName(a.user).localeCompare(userDisplayName(b.user), undefined, {
      sensitivity: 'base',
    });
  });
}

/**
 * "Make X the group owner": owners only, never for a deleted account, and not in a
 * community's announcement group (managed from the community: the server answers 403).
 */
export function canTransferGroupOwnership(chat, user) {
  return (
    chat.membership === 'active' &&
    chat.myRole === 'owner' &&
    !chat.isAnnouncement &&
    !user.isDeleted
  );
}

export function roleLabel(role, kind) {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return kind === 'group' ? 'Group admin' : 'Admin';
  return null;
}

/** Live member list of a chat (only fetched while `enabled`). */
export function useChatMembers(chatId, enabled) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef(null);

  const reload = useCallback(() => {
    if (!enabled) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    fetchMembers(chatId, c.signal)
      .then((list) => {
        if (c.signal.aborted) return;
        setMembers(list);
        setError(null);
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        setError(errorMessage(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
  }, [chatId, enabled]);

  useEffect(() => {
    if (!enabled) {
      setMembers(null);
      return;
    }
    reload();
    return () => ctrl.current?.abort();
  }, [enabled, reload]);

  useBus('chat:members-changed', ({ chatId: id }) => {
    if (id === chatId) reload();
  });
  useBus('realtime:ready', () => reload());

  return { members, error, loading, reload };
}
