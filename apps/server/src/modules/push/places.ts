/**
 * Where a push points (docs "Push"), shared by the reaction and reminder pushes: the title of
 * a chat as the recipient knows it, and the link that opens a message in it.
 */
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { isSpaceChatType, userDisplayName } from '@enbox/shared';
import { db } from '../../db/index.js';
import { chatMembers, spaces, type ChatRow } from '../../db/schema.js';
import { toUserPublicMap } from '../../services/users.js';
import { spacePushTitle } from './spaceNotifications.js';

/**
 * The chat's title for `viewerId`: `#name · Space` in Spaces (`spacePushTitle`), the other
 * person of a DM, a group's name (an unnamed group DM: its other members' names, owner first,
 * then who joined first), a broadcast channel's name.
 */
export async function pushPlaceTitle(chat: ChatRow, viewerId: string): Promise<string> {
  if (isSpaceChatType(chat.type)) {
    const [space] = chat.spaceId
      ? await db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, chat.spaceId))
      : [];
    return spacePushTitle(chat, space?.name ?? 'Space');
  }
  if (chat.type === 'channel') return chat.name ?? 'Channel';
  if (chat.type === 'group' && (chat.name || !chat.isGroupDm)) return chat.name ?? 'Group';
  const others = (
    await db
      .select({ userId: chatMembers.userId, role: chatMembers.role })
      .from(chatMembers)
      .where(
        and(
          eq(chatMembers.chatId, chat.id),
          isNull(chatMembers.leftAt),
          ne(chatMembers.userId, viewerId),
        ),
      )
      .orderBy(asc(chatMembers.joinedAt), asc(chatMembers.userId))
  )
    .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
    .map((r) => r.userId);
  // A self chat is titled with my own name.
  const ids = others.length ? others : [viewerId];
  const names = await toUserPublicMap(db, viewerId, ids);
  return ids.map((id) => userDisplayName(names.get(id))).join(', ');
}

/** The in-app link that opens a message in its chat (`?m=&mid=`). */
export function pushMessageUrl(
  chat: Pick<ChatRow, 'id' | 'type' | 'spaceId'>,
  message: { id: string; seq: number },
): string {
  const at = `?m=${message.seq}&mid=${message.id}`;
  if (chat.spaceId && isSpaceChatType(chat.type)) return `/spaces/${chat.spaceId}/${chat.id}${at}`;
  if (chat.type === 'channel') return `/updates/channels/${chat.id}${at}`;
  return `/chats/${chat.id}${at}`;
}
