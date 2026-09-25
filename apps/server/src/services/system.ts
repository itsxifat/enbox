/**
 * System messages (`type: 'system'`, `sender_id` null, `metadata.system` = SystemEvent).
 * Which kinds a chat may get (docs "Channels", "Communities", matrix):
 * - direct: disappearing_changed, message_pinned
 * - channel: channel_created, name_changed, description_changed, avatar_changed
 * - announcement group: community_created, name/description/avatar_changed,
 *   disappearing_changed, message_pinned (no join/leave/add/remove/role messages)
 * - group: everything except channel_created / community_created
 */
import type { SystemEvent, SystemEventKind } from '@enbox/shared';
import type { Tx } from '../db/index.js';
import type { ChatRow, MessageRow } from '../db/schema.js';
import { chatKindOfRow } from './chats.js';
import type { Effects } from './effects.js';
import { createMessage, insertMessage, type InsertedMessage } from './messages.js';

const DIRECT = new Set<SystemEventKind>(['disappearing_changed', 'message_pinned']);
const CHANNEL = new Set<SystemEventKind>([
  'channel_created',
  'name_changed',
  'description_changed',
  'avatar_changed',
]);
const ANNOUNCEMENT = new Set<SystemEventKind>([
  'community_created',
  'name_changed',
  'description_changed',
  'avatar_changed',
  'disappearing_changed',
  'message_pinned',
]);
const GROUP_EXCLUDED = new Set<SystemEventKind>(['channel_created', 'community_created']);

/** Whether a chat may carry a system message of this kind. */
export function systemMessageAllowed(
  chat: Pick<ChatRow, 'type' | 'isAnnouncement'>,
  kind: SystemEventKind,
): boolean {
  switch (chatKindOfRow(chat)) {
    case 'direct':
      return DIRECT.has(kind);
    case 'channel':
      return CHANNEL.has(kind);
    case 'announcement':
      return ANNOUNCEMENT.has(kind);
    case 'group':
      return !GROUP_EXCLUDED.has(kind);
  }
}

/** The acting user of a system event (withheld from direct-chat peers who blocked them). */
function actorOf(event: SystemEvent): string | null {
  return 'actorId' in event ? event.actorId : null;
}

function assertAllowed(chat: Pick<ChatRow, 'type' | 'isAnnouncement' | 'id'>, event: SystemEvent) {
  if (!systemMessageAllowed(chat, event.kind)) {
    throw new Error(
      `System message '${event.kind}' is not allowed in ${chatKindOfRow(chat)} chat ${chat.id}`,
    );
  }
}

/**
 * `postSystemMessage(tx, fx, chat, event)`: create the system message through the normal
 * send path (chat lock, seq, unhide, delivered…) and register its `message:new` → room.
 * Throws (programming error) when the kind is not allowed in this chat — check with
 * `systemMessageAllowed` for optional messages. `exceptUserIds`: members still in the room
 * who must not receive it (e.g. someone who left earlier in the same tx). In direct chats the
 * event's `actorId` is treated like a sender: a peer who blocked the actor never sees it.
 */
export async function postSystemMessage(
  tx: Tx,
  fx: Effects,
  chat: Pick<ChatRow, 'id' | 'type' | 'isAnnouncement'>,
  event: SystemEvent,
  opts: { exceptUserIds?: string[] } = {},
): Promise<MessageRow> {
  assertAllowed(chat, event);
  const { message } = await createMessage(tx, fx, {
    chatId: chat.id,
    senderId: null,
    type: 'system',
    metadata: { system: event },
    exceptUserIds: opts.exceptUserIds,
    actorId: actorOf(event),
  });
  return message;
}

/** Like postSystemMessage but WITHOUT registering the fan-out (call `.publish(fx)` later). */
export async function insertSystemMessage(
  tx: Tx,
  chat: Pick<ChatRow, 'id' | 'type' | 'isAnnouncement'>,
  event: SystemEvent,
): Promise<InsertedMessage> {
  assertAllowed(chat, event);
  return insertMessage(tx, {
    chatId: chat.id,
    senderId: null,
    type: 'system',
    metadata: { system: event },
    actorId: actorOf(event),
  });
}
