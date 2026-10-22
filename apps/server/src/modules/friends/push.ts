/**
 * Friend pushes (docs "Push"): a new request → the target; an accepted request → whoever
 * sent it. Started after commit (see service.ts) and tracked like every other push. Title:
 * the other user as the recipient knows them, with their (static) avatar as the icon; one
 * tag per pair so a later push replaces an earlier one. Not in do not disturb, like messages.
 * The payload is a `message` push without a chat (the service worker shows it unless the
 * app is focused, where the in-app toast takes over); clicking opens the Friends page.
 */
import { PUSH_MESSAGE_TTL_SEC, isDnd, userDisplayName, type ID } from '@enbox/shared';
import { db } from '../../db/index.js';
import { getUserRow, toUserPublic } from '../../services/users.js';
import { deliverPush, getPushSender } from '../push/sender.js';

export async function pushFriendEvent(
  kind: 'request' | 'accepted',
  fromId: ID,
  toId: ID,
): Promise<void> {
  if (!getPushSender()) return;
  const recipient = await getUserRow(db, toId);
  if (!recipient || recipient.deletedAt || isDnd(recipient)) return;
  const from = await toUserPublic(db, toId, fromId);
  if (!from || from.isDeleted) return;
  await deliverPush([
    {
      userId: toId,
      payload: {
        type: 'message',
        title: userDisplayName(from),
        body: kind === 'request' ? 'Sent you a friend request' : 'Accepted your friend request',
        tag: `friend:${fromId}`,
        url: kind === 'request' ? '/chats?friends=pending' : '/chats?friends=all',
        ...(from.avatarUrl ? { icon: from.avatarUrl } : {}),
      },
      opts: { ttl: PUSH_MESSAGE_TTL_SEC },
    },
  ]);
}
