/**
 * Suggestions and chip labels of the header search: people for `from:` / `mentions:`
 * (Spaces search their members on the server, debounced like @mention suggestions; DMs and
 * groups filter the chat's member list, a DM without one offers me and the peer) and text
 * channels and voice / Stage chats for `in:` (Spaces only).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  isVoiceChannelType,
  userDisplayName,
  type ChatSummary,
  type ID,
  type SpaceMemberPage,
} from '@enbox/shared';
import { useChatMembers } from '@/features/conversation/members';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChat, useChats } from '@/stores/chats';
import type { SearchScope } from '@/stores/sidePanel';
import { useSpaceChannels, useSpaceMember, useSpaces } from '@/stores/spaces';
import { useUser, useUsers } from '@/stores/users';
import type { SearchToken } from './query';

export interface PersonCandidate {
  id: ID;
  /** Nickname in the Space, else the display name. */
  name: string;
  username: string | null;
}

/** The fields of a user (or of me) a suggestion needs. */
interface PersonLike {
  id: ID;
  displayName: string;
  username: string;
  contactName?: string | null;
  isDeleted?: boolean;
}

/** Suggestions shown at most. */
export const MAX_CANDIDATES = 8;
const MEMBER_SEARCH_DEBOUNCE_MS = 150;

function matches(partial: string, ...fields: (string | null | undefined)[]): boolean {
  const q = partial.trim().replace(/^[@#]/, '').toLowerCase();
  return !q || fields.some((f) => !!f && f.toLowerCase().includes(q));
}

const nameOf = (u: PersonLike) =>
  userDisplayName({ displayName: u.displayName, contactName: u.contactName ?? null, isDeleted: u.isDeleted });

/** People matching `partial` (null: not asked for; nothing is loaded). */
export function usePersonCandidates(scope: SearchScope, partial: string | null): PersonCandidate[] {
  const spaceId = scope.kind === 'space' ? scope.spaceId : null;
  const chat = useChat(scope.kind === 'chat' ? scope.chatId : null);
  const [found, setFound] = useState<ID[]>([]);
  const users = useUsers((s) => s.byId);
  const members = useSpaces((s) => (spaceId ? s.members[spaceId] : undefined));
  const chatMembers = useChatMembers(partial === null ? undefined : chat);
  const me = useAuth((s) => s.user);

  useEffect(() => {
    if (!spaceId || partial === null) return;
    let live = true;
    const timer = setTimeout(() => {
      void api
        .get<SpaceMemberPage>(`/api/spaces/${spaceId}/members`, {
          query: { q: partial.trim().replace(/^@/, '') || undefined, limit: MAX_CANDIDATES },
        })
        .then((page) => {
          if (!live) return;
          useSpaces.getState().upsertMembers(spaceId, page.members);
          void useUsers
            .getState()
            .fetchUsers(page.members.map((m) => m.userId))
            .catch(() => undefined);
          setFound(page.members.map((m) => m.userId));
        })
        .catch(() => undefined);
    }, MEMBER_SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [spaceId, partial]);

  return useMemo(() => {
    if (partial === null) return [];
    if (spaceId) {
      const out: PersonCandidate[] = [];
      for (const id of found) {
        const u: PersonLike | undefined = id === me?.id ? me : users[id];
        if (!u || u.isDeleted) continue;
        out.push({ id, name: members?.[id]?.nickname || nameOf(u), username: u.username });
      }
      return out;
    }
    if (!chat) return [];
    const people: PersonLike[] = chatMembers?.map((m) => m.user) ?? directPeople(chat, me);
    return people
      .filter((u) => !u.isDeleted && matches(partial, u.displayName, u.contactName, u.username))
      .slice(0, MAX_CANDIDATES)
      .map((u) => ({ id: u.id, name: nameOf(u), username: u.username }));
  }, [partial, spaceId, found, users, members, me, chat, chatMembers]);
}

function directPeople(chat: ChatSummary, me: PersonLike | null): PersonLike[] {
  const out: PersonLike[] = me ? [me] : [];
  if (chat.peer && chat.peer.id !== me?.id) out.push(chat.peer);
  return out;
}

export interface ChannelCandidate {
  id: ID;
  name: string;
}

/**
 * The Space's text channels and voice / Stage chats I can see matching `partial`, the current
 * one first (null: none).
 */
export function useChannelCandidates(scope: SearchScope, partial: string | null): ChannelCandidate[] {
  const spaceId = scope.kind === 'space' ? scope.spaceId : null;
  const current = scope.kind === 'space' ? scope.channelId : undefined;
  const channels = useSpaceChannels(spaceId);
  return useMemo(() => {
    if (partial === null || !spaceId) return [];
    const list = channels.filter(
      (c) => (c.type === 'space_text' || isVoiceChannelType(c.type)) && matches(partial, c.name),
    );
    const at = list.findIndex((c) => c.id === current);
    if (at > 0) list.unshift(...list.splice(at, 1));
    return list.slice(0, MAX_CANDIDATES).map((c) => ({ id: c.id, name: c.name ?? 'channel' }));
  }, [channels, partial, spaceId, current]);
}

/**
 * What a chip shows after its key: a person's name, `#channel` (a voice or Stage channel: its
 * name, they carry no `#`), or the value itself.
 */
export function useTokenLabel(scope: SearchScope, token: SearchToken): string {
  const person = token.key === 'from' || token.key === 'mentions' ? token.value : null;
  const me = useAuth((s) => s.user);
  const user = useUser(person && person !== me?.id ? person : null);
  const member = useSpaceMember(scope.kind === 'space' ? scope.spaceId : null, person);
  const channel = useChats((s) => (token.key === 'in' ? s.byId[token.value] : undefined));
  if (person) {
    if (member?.nickname) return member.nickname;
    if (me && person === me.id) return me.displayName;
    return user ? userDisplayName(user) : 'someone';
  }
  if (token.key === 'in')
    return channel && isVoiceChannelType(channel.type)
      ? (channel.name ?? 'channel')
      : `#${channel?.name ?? 'channel'}`;
  return token.value;
}
