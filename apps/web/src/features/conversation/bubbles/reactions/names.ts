/**
 * Who reacted, for the tooltip: the first reactor ids of a chip (me first) and their names
 * (Space nicknames win). Direct chats and groups have the lists; Space channels fetch the
 * first few on hover (cached briefly); broadcast channels never name anyone.
 */
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { userDisplayName, type ChatSummary, type ID, type ReactionSummary } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { reactorsHidden, reactorsListed } from './model';
import { fetchReactors } from './reactionActions';

/** Names shown in a tooltip (Discord shows up to three). */
const TOOLTIP_NAMES = 3;
const CACHE_MS = 30_000;
const firstReactors = new Map<string, { at: number; ids: ID[] }>();

/** Me first (when mine), then the others in reaction order; at most `n`. */
export function orderReactors(
  ids: readonly ID[],
  me: ID | null | undefined,
  mine: boolean,
  n: number,
): ID[] {
  const rest = ids.filter((id) => id !== me);
  return (mine && me ? [me, ...rest] : rest).slice(0, n);
}

/** The first reactors of a chip (fetched in Space channels while `active`). */
export function useFirstReactors(
  chat: ChatSummary,
  messageId: ID,
  r: ReactionSummary,
  mine: boolean,
  active: boolean,
): ID[] {
  const me = useAuth((s) => s.user?.id);
  const key = `${messageId}|${r.emoji}|${r.count}`;
  const fetchable = active && !reactorsListed(chat) && !reactorsHidden(chat);
  const [fetched, setFetched] = useState<ID[] | null>(() => firstReactors.get(key)?.ids ?? null);
  useEffect(() => {
    if (!fetchable) return;
    const hit = firstReactors.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setFetched(hit.ids);
      return;
    }
    let live = true;
    void fetchReactors(messageId, r.emoji, { limit: TOOLTIP_NAMES })
      .then((users) => {
        const ids = users.map((u) => u.id);
        firstReactors.set(key, { at: Date.now(), ids });
        if (live) setFetched(ids);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fetchable, key, messageId, r.emoji]);
  if (reactorsHidden(chat)) return mine && me ? [me] : [];
  return orderReactors(reactorsListed(chat) ? r.userIds : (fetched ?? []), me, mine, TOOLTIP_NAMES);
}

/** Display names of `ids` ("You" for me; Space nicknames win). Unknown users are left out. */
export function useReactorNames(ids: readonly ID[], spaceId: ID | null | undefined): string[] {
  const me = useAuth((s) => s.user?.id);
  const users = useUsers(useShallow((s) => ids.map((id) => s.byId[id])));
  const nicknames = useSpaces(
    useShallow((s) =>
      ids.map((id) => (spaceId ? (s.members[spaceId]?.[id]?.nickname ?? null) : null)),
    ),
  );
  const missing = ids.filter((id, i) => id !== me && !users[i]).join(',');
  useEffect(() => {
    if (!missing) return;
    void useUsers
      .getState()
      .fetchUsers(missing.split(','))
      .catch(() => undefined);
  }, [missing]);
  return ids.flatMap((id, i) => {
    if (id === me) return ['You'];
    const u = users[i];
    return u ? [nicknames[i] || userDisplayName(u)] : [];
  });
}
