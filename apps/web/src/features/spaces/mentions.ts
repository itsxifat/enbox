import { useEffect, useMemo, useState } from 'react';
import {
  EVERYONE_TOKEN,
  HERE_TOKEN,
  PERM,
  hasPerm,
  userDisplayName,
  type ChatSummary,
  type SpaceMemberPage,
  type UserPublic,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useSpace, useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';

/** One @mention suggestion: a user, @everyone/@here, or a role. */
export interface MentionCandidate {
  key: string;
  /**
   * What `MentionRef.userId` records; `mentionToken(token)` gives the text token
   * (`@{<uuid>}`, `@{everyone}`, `@{here}`, `@{role:<uuid>}`).
   */
  token: string;
  /** Inserted as "@name". */
  name: string;
  sub?: string;
  user?: UserPublic;
  color?: string | null;
}

export const EVERYONE_REF = EVERYONE_TOKEN.slice(2, -1);
export const HERE_REF = HERE_TOKEN.slice(2, -1);

const norm = (s: string) => s.toLowerCase().replace(/^@/, '');

/** Suggestions while typing "@query" in a space channel (members searched on the server). */
export function useSpaceMentionCandidates(chat: ChatSummary, query: string | null, meId: string | undefined): MentionCandidate[] {
  const spaceId = chat.space?.spaceId;
  const space = useSpace(spaceId);
  const [found, setFound] = useState<string[]>([]);
  const users = useUsers((s) => s.byId);
  const members = useSpaces((s) => (spaceId ? s.members[spaceId] : undefined));

  useEffect(() => {
    if (!spaceId || query === null) return;
    let live = true;
    const t = setTimeout(() => {
      void api
        .get<SpaceMemberPage>(`/api/spaces/${spaceId}/members`, { query: { q: query || undefined, limit: 8 } })
        .then((page) => {
          if (!live) return;
          useSpaces.getState().upsertMembers(spaceId, page.members);
          void useUsers.getState().fetchUsers(page.members.map((m) => m.userId)).catch(() => undefined);
          setFound(page.members.map((m) => m.userId));
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [spaceId, query]);

  return useMemo(() => {
    if (!space || query === null) return [];
    const q = norm(query);
    const out: MentionCandidate[] = [];
    for (const id of found) {
      if (id === meId) continue;
      const u = users[id];
      if (!u || u.isDeleted) continue;
      const nick = members?.[id]?.nickname;
      const name = nick || userDisplayName(u);
      out.push({ key: id, token: id, name, sub: `@${u.username}`, user: u });
    }
    const loud = hasPerm(chat.spacePermissions, PERM.MENTION_EVERYONE);
    for (const r of [...space.roles].sort((a, b) => b.position - a.position)) {
      if (r.isDefault || !(r.mentionable || loud)) continue;
      if (q && !r.name.toLowerCase().includes(q)) continue;
      out.push({ key: `role:${r.id}`, token: `role:${r.id}`, name: r.name, sub: 'Role', color: r.color });
    }
    if (loud) {
      if ('everyone'.startsWith(q)) out.push({ key: 'everyone', token: EVERYONE_REF, name: 'everyone', sub: 'Notify everyone who can see this channel' });
      if ('here'.startsWith(q)) out.push({ key: 'here', token: HERE_REF, name: 'here', sub: 'Notify everyone online' });
    }
    return out.slice(0, 10);
  }, [space, query, found, users, members, meId, chat.spacePermissions]);
}
