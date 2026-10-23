/**
 * Group DM names (Discord): a group DM without a name shows its other members' names, joined
 * with commas (just mine when I'm alone in it). The members come from the conversation's
 * members cache (`GET /api/chats/:chatId/members`, refreshed on `chat:members-changed`).
 */
import {
  chatTitle,
  userDisplayName,
  type ChatMember,
  type ChatSummary,
  type ID,
  type UserPublic,
} from '@enbox/shared';
import { useChatMembers } from '@/features/conversation/members';
import { useAuth } from '@/stores/auth';
import { useUsers } from '@/stores/users';

/** Shown while the members of an unnamed group DM load (or when I can't list them any more). */
export const UNNAMED_GROUP_DM = 'Group DM';

/** The other members' names (live profiles first), or mine when I'm alone; null until loaded. */
export function groupDmMemberNames(
  members: readonly ChatMember[] | undefined,
  meId: ID | undefined,
  byId: Readonly<Record<ID, UserPublic | undefined>>,
): string | null {
  if (!members?.length) return null;
  const others = members.filter((m) => m.user.id !== meId);
  return (others.length ? others : members)
    .map((m) => userDisplayName(byId[m.user.id] ?? m.user))
    .join(', ');
}

/** True for a group DM that has no name of its own (its members' names stand in). */
export function isUnnamedGroupDm(chat: Pick<ChatSummary, 'isGroupDm' | 'name'>): boolean {
  return chat.isGroupDm === true && !chat.name;
}

/**
 * A chat's title: `chatTitle` (with "(You)" on my own chat when `me`), except an unnamed
 * group DM, which shows its members' names.
 */
export function useChatTitle(chat: ChatSummary, opts: { me?: boolean } = {}): string {
  const meId = useAuth((s) => s.user?.id);
  const unnamed = isUnnamedGroupDm(chat);
  const members = useChatMembers(unnamed ? chat : undefined);
  // A string selector: rows re-render only when the names they show change.
  const names = useUsers((s) => (unnamed ? groupDmMemberNames(members, meId, s.byId) : null));
  if (unnamed) return names ?? chatTitle(chat);
  return chatTitle(chat, opts.me ? meId : undefined);
}
