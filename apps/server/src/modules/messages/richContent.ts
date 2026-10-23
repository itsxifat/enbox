/**
 * Rich content routes of the messages module (docs/design/discord-parity.md W6-E):
 *
 *   GET   /messages/:messageId                   one message I can see (message link cards)
 *   PATCH /messages/:messageId/suppress-embeds   { suppress } → MESSAGE_FLAGS.SUPPRESS_EMBEDS
 *
 * Embeds are rendered by clients (link previews, players, invite and message cards); the
 * flag tells them to show none. Sends set it themselves in a Space channel where the sender
 * lacks EMBED_LINKS (./service.ts `sendMessage`).
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { MESSAGE_FLAGS, PERM, hasPerm, type Message } from '@enbox/shared';
import { db } from '../../db/index.js';
import { messages } from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { getChatAccess, peersWhoBlockedMe, requireActiveMember } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { loadVisibleMessage, toMessages } from '../../services/messages.js';

/** `PATCH /messages/:messageId/suppress-embeds` body. */
export const suppressEmbedsSchema = z.object({ suppress: z.boolean() });

/**
 * `GET /messages/:messageId`: the message when it is visible to me (my membership window,
 * hidden rows, expiry: `loadVisibleMessage`) and I can still see its chat — a Space channel's
 * read row outlives the access (a role removed, a channel made private), a chat deleted for
 * me is gone — else 404, also for chats I was never in.
 */
export async function getMessage(me: string, messageId: string): Promise<Message> {
  const { message, chat } = await loadVisibleMessage(db, me, messageId);
  await getChatAccess(db, me, chat.id).catch(() => {
    throw notFound('Message');
  });
  const [out] = await toMessages(db, me, [message]);
  return out!;
}

/**
 * `PATCH /messages/:messageId/suppress-embeds`: sets or clears SUPPRESS_EMBEDS ("Remove all
 * embeds"). Active members only (403 not_member); the author — any admin who can post, for a
 * broadcast channel's posts — or a Space channel's MANAGE_MESSAGES (403 otherwise). Without
 * EMBED_LINKS an author cannot bring the embeds back (a moderator can). System, call and
 * deleted messages have none (400). Unchanged → no-op; else `message:updated` → room (direct
 * chat whose peer blocked me: not to the peer).
 */
export async function suppressEmbeds(
  me: string,
  messageId: string,
  suppress: boolean,
): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const first = await loadVisibleMessage(tx, me, messageId);
    const access = await requireActiveMember(tx, me, first.message.chatId, { lock: true });
    const { message } = await loadVisibleMessage(tx, me, messageId, { chatId: access.chat.id });
    if (message.type === 'system' || message.type === 'call' || message.deletedAt)
      throw badRequest('This message has no embeds');
    const bits = access.space?.bits ?? 0;
    const moderator = !!access.space && hasPerm(bits, PERM.MANAGE_MESSAGES);
    const author =
      access.chat.type === 'channel' ? access.permissions.canSend : message.senderId === me;
    if (!author && !moderator) throw forbidden('You can only remove embeds from your own messages');
    if (!suppress && access.space && !moderator && !hasPerm(bits, PERM.EMBED_LINKS))
      throw forbidden('You cannot embed links in this channel');
    const flags = suppress
      ? message.flags | MESSAGE_FLAGS.SUPPRESS_EMBEDS
      : message.flags & ~MESSAGE_FLAGS.SUPPRESS_EMBEDS;
    if (flags === message.flags) return message;
    const [updated] = await tx
      .update(messages)
      .set({ flags })
      .where(eq(messages.id, message.id))
      .returning();
    fx.messageUpdated(message.id, { exceptUserIds: await peersWhoBlockedMe(tx, access) });
    return updated!;
  });
  const [out] = await toMessages(db, me, [row]);
  return out!;
}
