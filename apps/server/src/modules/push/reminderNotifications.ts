/**
 * Reminder pushes (docs "Push"): when a reminder fires, "Reminder: <preview>" titled with the
 * place of the message as I know it (./places.ts), the sender's avatar as the icon; "Reminder:
 * a message you saved" when previews are off. Not in do not disturb, like every push, and only
 * while the message is there for me (the caller passes the bookmark as I see it). One tag per
 * message (`reminder:<id>`); a click opens the chat at the message. Started after commit
 * (bookmarks/service.ts `sendDueReminders`) and tracked like every other push.
 */
import { eq } from 'drizzle-orm';
import {
  PUSH_MESSAGE_TTL_SEC,
  isDnd,
  messagePreviewText,
  truncate,
  userDisplayName,
  type Bookmark,
  type ID,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { chats } from '../../db/schema.js';
import { chatKindOfRow } from '../../services/chats.js';
import { uniq } from '../../services/sql.js';
import { getUserRow, settingsOf, toUserPublicMap } from '../../services/users.js';
import { pushMessageUrl, pushPlaceTitle } from './places.js';
import { deliverPush, getPushSender } from './sender.js';

const PREVIEW_MAX = 120;

export async function pushReminder(userId: ID, bookmark: Bookmark): Promise<void> {
  const msg = bookmark.message;
  if (!getPushSender() || !msg) return;
  const user = await getUserRow(db, userId);
  if (!user || user.deletedAt || isDnd(user)) return;
  const [chat] = await db.select().from(chats).where(eq(chats.id, bookmark.chatId)).limit(1);
  if (!chat) return;
  const users = await toUserPublicMap(
    db,
    userId,
    uniq([msg.senderId, ...msg.mentions].filter((id): id is string => !!id)),
  );
  const nameOf = (id: string) => userDisplayName(users.get(id));
  const preview = settingsOf(user).notificationPreviews
    ? truncate(
        messagePreviewText(msg, nameOf, { viewerId: userId, chatKind: chatKindOfRow(chat) }),
        PREVIEW_MAX,
      )
    : '';
  const icon = msg.senderId ? users.get(msg.senderId)?.avatarUrl : null;
  await deliverPush([
    {
      userId,
      payload: {
        type: 'message',
        title: await pushPlaceTitle(chat, userId),
        body: `Reminder: ${preview || 'a message you saved'}`,
        tag: `reminder:${msg.id}`,
        url: pushMessageUrl(chat, msg),
        chatId: chat.id,
        ...(icon ? { icon } : {}),
      },
      opts: { ttl: PUSH_MESSAGE_TTL_SEC },
    },
  ]);
}
