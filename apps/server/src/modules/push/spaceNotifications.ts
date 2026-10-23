/**
 * Pushes for messages in space channels (docs/design/spaces-at-scale.md "Push and mentions").
 *
 * Targets, from one bounded query (≤ PUSH_SPACE_ALL_CAP, only users with a push
 * subscription): mentioned users, members of mentioned roles and everyone for @everyone/@here
 * (unless they suppress role or @everyone mentions in that Space), and members whose
 * notification level is 'all'. The level chain
 * is channel row → member → Space default ('mentions' by default); 'none' never pushes,
 * 'mentions' only for mentions. Then: not ignoring or blocking the sender, not muted (Space
 * or channel), not in DND, group notifications on, and VIEW_CHANNEL (computed like
 * everywhere else).
 */
import { sql } from 'drizzle-orm';
import {
  PERM,
  PUSH_MESSAGE_TTL_SEC,
  PUSH_SPACE_ALL_CAP,
  hasPerm,
  isDnd,
  isMuted,
  isVoiceChannelType,
  messagePreviewText,
  truncate,
  userDisplayName,
  type NotifyLevel,
  type PushPayload,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import type { ChatRow, MessageRow } from '../../db/schema.js';
import { toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpaceMembers,
  loadSpacePermCtx,
} from '../../services/spaceAccess.js';
import { pairKey, rawRows, uniq, uuidArray } from '../../services/sql.js';
import { getUserRows, settingsOf, toUserPublicsForPairs } from '../../services/users.js';
import { silencedRecipients } from '../ignores/service.js';
import { deliverPush, type PushEntry } from './sender.js';

const PREVIEW_MAX = 120;

interface Candidate {
  user_id: string;
  s_level: NotifyLevel | null;
  s_muted: string | null;
  c_level: NotifyLevel | null;
  c_muted: string | null;
  mentioned: boolean;
}

/**
 * A push's title: `#name · Space` for text channels; the text chat of a voice or Stage channel
 * reads `🔊 name · Space` (their names carry no `#`).
 */
export function spacePushTitle(chat: Pick<ChatRow, 'type' | 'name'>, spaceName: string): string {
  return isVoiceChannelType(chat.type)
    ? `🔊 ${chat.name ?? 'Voice'} · ${spaceName}`
    : `#${chat.name ?? 'channel'} · ${spaceName}`;
}

export async function onSpaceMessageCreated(message: MessageRow, chat: ChatRow): Promise<void> {
  if (!chat.spaceId || !message.senderId || message.type === 'system' || message.type === 'call')
    return;
  const [space] = await rawRows<{ name: string; default_notify_level: 'all' | 'mentions' }>(
    db,
    sql`select name, default_notify_level from spaces where id = ${chat.spaceId}`,
  );
  if (!space) return;
  const mentions = message.mentions ?? [];
  const roleIds = message.mentionRoleIds ?? [];
  const everyone = message.mentionEveryone;
  const candidates = await rawRows<Candidate>(
    db,
    sql`select sm.user_id, sm.notify_level as s_level, sm.muted_until as s_muted,
               cm.notify_level as c_level, cm.muted_until as c_muted,
               (sm.user_id = any(${uuidArray(mentions)})
                or (not sm.suppress_roles and exists (select 1 from space_member_roles r
                    where r.space_id = sm.space_id and r.user_id = sm.user_id
                      and r.role_id = any(${uuidArray(roleIds)})))
                or (${everyone} and not sm.suppress_everyone)) as mentioned
        from space_members sm
        left join chat_members cm on cm.chat_id = ${chat.id} and cm.user_id = sm.user_id
        where sm.space_id = ${chat.spaceId} and sm.user_id <> ${message.senderId}
          and exists (select 1 from push_subscriptions ps where ps.user_id = sm.user_id)
          and (sm.user_id = any(${uuidArray(mentions)})
               or (not sm.suppress_roles and exists (select 1 from space_member_roles r
                   where r.space_id = sm.space_id and r.user_id = sm.user_id
                     and r.role_id = any(${uuidArray(roleIds)})))
               or (${everyone} and not sm.suppress_everyone)
               or coalesce(cm.notify_level, sm.notify_level, ${space.default_notify_level}) = 'all')
        limit ${PUSH_SPACE_ALL_CAP}`,
  );
  if (candidates.length === 0) return;

  // No push, mentions included, from someone the member ignores (or blocked): one query.
  const silenced = await silencedRecipients(
    db,
    message.senderId,
    candidates.map((c) => c.user_id),
  );
  const now = new Date();
  const wanted = candidates.filter((c) => {
    if (silenced.has(c.user_id)) return false;
    const level = c.c_level ?? c.s_level ?? space.default_notify_level;
    if (level === 'none' || (level === 'mentions' && !c.mentioned)) return false;
    const muted = (v: string | null) => v && isMuted(new Date(v).toISOString(), now);
    return !muted(c.s_muted) && !muted(c.c_muted);
  });
  if (wanted.length === 0) return;

  // Who can see the channel.
  const ctx = await loadSpacePermCtx(db, chat.spaceId);
  if (!ctx) return;
  const overwrites = (await loadChannelOverwrites(db, [chat.id])).get(chat.id) ?? [];
  const members = await loadSpaceMembers(
    db,
    chat.spaceId,
    wanted.map((c) => c.user_id),
  );
  const rows = await getUserRows(
    db,
    wanted.map((c) => c.user_id),
  );
  const eligible = wanted
    .map((c) => c.user_id)
    .filter((id) => {
      const m = members.get(id);
      const row = rows.get(id);
      if (!m || !row || row.deletedAt || isDnd(row, now.getTime())) return false;
      if (!settingsOf(row).groupNotifications) return false;
      return hasPerm(
        channelBits(ctx, id, m, chat.type as 'space_text', overwrites),
        PERM.VIEW_CHANNEL,
      );
    });
  if (eligible.length === 0) return;

  const [msg] = await toMessages(db, null, [message]);
  if (!msg) return;
  const senderId = message.senderId;
  const refIds = uniq([senderId, ...msg.mentions]);
  const publics = await toUserPublicsForPairs(
    db,
    eligible.flatMap((viewerId) => refIds.map((subjectId) => ({ viewerId, subjectId }))),
  );
  const senderMember = (await loadSpaceMembers(db, chat.spaceId, [senderId])).get(senderId);
  const roleName = (id: string) => ctx.roles.find((r) => r.id === id)?.name ?? 'role';

  const entries: PushEntry[] = eligible.map((viewerId) => {
    const s = settingsOf(rows.get(viewerId)!);
    const nameOf = (id: string) => userDisplayName(publics.get(pairKey(viewerId, id)));
    const senderName = senderMember?.member.nickname || nameOf(senderId);
    const preview = s.notificationPreviews
      ? truncate(
          messagePreviewText(
            {
              ...msg,
              text:
                msg.text?.replace(
                  /@\{role:([0-9a-f-]{36})\}/g,
                  (_, id: string) => `@${roleName(id)}`,
                ) ?? null,
            },
            nameOf,
            { viewerId, chatKind: 'space' },
          ),
          PREVIEW_MAX,
        )
      : 'New message';
    const payload: PushPayload = {
      type: 'message',
      title: spacePushTitle(chat, space.name),
      body: s.notificationPreviews ? `${senderName}: ${preview}` : preview,
      tag: `chat:${chat.id}`,
      // A voice or Stage chat opens beside its call view, at the message (`?m=&mid=`).
      url: isVoiceChannelType(chat.type)
        ? `/spaces/${chat.spaceId}/${chat.id}?m=${msg.seq}&mid=${msg.id}`
        : `/spaces/${chat.spaceId}/${chat.id}`,
      chatId: chat.id,
    };
    return { userId: viewerId, payload, opts: { ttl: PUSH_MESSAGE_TTL_SEC } };
  });
  await deliverPush(entries);
}
