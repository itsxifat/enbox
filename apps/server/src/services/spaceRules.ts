/**
 * Space channel rules that `ChatPermissions` has no boolean for (docs/design/spaces-at-scale.md
 * "Permissions"): attachments, polls, reactions, slowmode, who may @everyone / @role, and the
 * Space's verification level.
 */
import { and, eq } from 'drizzle-orm';
import {
  PERM,
  USER_RATE_LIMITS,
  extractSpaceMentions,
  hasAnyPerm,
  hasPerm,
  isSpaceAdmin,
  type MessageType,
} from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import { chatMembers, spaces, users } from '../db/schema.js';
import { forbidden, rateLimited } from '../lib/errors.js';
import { assertUserLimit } from '../lib/userLimit.js';
import type { ChatAccess } from './chats.js';

const MEDIA_TYPES = new Set<MessageType>(['image', 'video', 'audio', 'voice', 'file']);

/** What a text may mention in a space channel, given the sender's bits. */
export function allowedSpaceMentions(
  access: ChatAccess,
  text: string | null | undefined,
): { everyone: boolean; roleIds: string[] } {
  const s = access.space;
  if (!s) return { everyone: false, roleIds: [] };
  const m = extractSpaceMentions(text);
  const may = hasPerm(s.bits, PERM.MENTION_EVERYONE);
  const roles = new Map(s.ctx.roles.map((r) => [r.id, r]));
  return {
    everyone: (m.everyone || m.here) && may,
    roleIds: m.roleIds.filter((id) => {
      const r = roles.get(id);
      return !!r && !r.isDefault && (r.mentionable || may);
    }),
  };
}

/**
 * Checks before a send in a space channel (403/429), and the mentions to store. Slowmode:
 * one message per `slowmode_seconds` per member, MANAGE_MESSAGES/MANAGE_CHANNELS bypass.
 */
export function spaceSendRules(
  access: ChatAccess,
  me: string,
  body: { type: MessageType; text?: string | null },
): { everyone: boolean; roleIds: string[] } {
  const s = access.space;
  if (!s) return { everyone: false, roleIds: [] };
  if (MEDIA_TYPES.has(body.type) && !hasPerm(s.bits, PERM.ATTACH_FILES))
    throw forbidden('You cannot attach files in this channel');
  if (body.type === 'poll' && !hasPerm(s.bits, PERM.SEND_POLLS))
    throw forbidden('You cannot create polls in this channel');
  const slow = access.chat.slowmodeSeconds;
  if (slow > 0 && !hasAnyPerm(s.bits, PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS)) {
    const last = access.member.lastSentAt?.getTime() ?? 0;
    const wait = Math.ceil((last + slow * 1000 - Date.now()) / 1000);
    if (wait > 0) throw rateLimited(`Slowmode is on: wait ${wait}s before sending again`);
  }
  const mentions = allowedSpaceMentions(access, body.text);
  if (mentions.everyone) assertUserLimit(me, 'mentionEveryone', USER_RATE_LIMITS.mentionEveryone);
  return mentions;
}

/** Verification level 2 (Medium): the account is older than this. */
export const VERIFICATION_ACCOUNT_AGE_MS = 5 * 60_000;
/** Verification level 3 (High): a member of the Space for longer than this. */
export const VERIFICATION_MEMBER_AGE_MS = 10 * 60_000;

function waitText(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  return min <= 1 ? 'a minute' : `${min} minutes`;
}

/**
 * The Space's verification level before a send (Discord: members with a role, the owner and
 * administrators are exempt; levels are cumulative). What Enbox can check: Medium (account
 * older than 5 minutes) and High (member for longer than 10 minutes). Low (verified email)
 * and Highest's phone check are stored but not enforced: accounts have no email and phone
 * numbers are not verified. One indexed lookup, only for members without roles.
 */
export async function assertSpaceVerification(
  dbx: DbOrTx,
  access: ChatAccess,
  me: string,
  now = Date.now(),
): Promise<void> {
  const s = access.space;
  if (!s || s.me.roleIds.length > 0 || s.ctx.ownerId === me || isSpaceAdmin(s.base)) return;
  const [row] = await dbx
    .select({ level: spaces.verificationLevel, createdAt: users.createdAt })
    .from(spaces)
    .innerJoin(users, eq(users.id, me))
    .where(eq(spaces.id, s.ctx.spaceId))
    .limit(1);
  if (!row || row.level < 2) return;
  const accountWait = row.createdAt.getTime() + VERIFICATION_ACCOUNT_AGE_MS - now;
  if (accountWait > 0)
    throw forbidden(
      `This Space requires accounts older than 5 minutes. You can talk here in ${waitText(accountWait)}.`,
    );
  if (row.level < 3) return;
  const memberWait = s.me.member.joinedAt.getTime() + VERIFICATION_MEMBER_AGE_MS - now;
  if (memberWait > 0)
    throw forbidden(
      `This Space requires you to be a member for 10 minutes before talking. You can talk here in ${waitText(memberWait)}.`,
    );
}

/** After a send: record it for slowmode (the sender's read row exists by then). */
export async function touchSlowmode(dbx: DbOrTx, access: ChatAccess, me: string): Promise<void> {
  if (!access.space || access.chat.slowmodeSeconds <= 0) return;
  await dbx
    .update(chatMembers)
    .set({ lastSentAt: new Date() })
    .where(and(eq(chatMembers.chatId, access.chat.id), eq(chatMembers.userId, me)));
}

/** 403 unless the viewer may react here (space channels: ADD_REACTIONS). */
export function assertCanReact(access: ChatAccess): void {
  if (access.space && !hasPerm(access.space.bits, PERM.ADD_REACTIONS))
    throw forbidden('You cannot add reactions in this channel');
}

/** Actions that do not exist in space channels (clear, delete-for-me of a chat, timers…). */
export function assertNotSpaceChannel(access: ChatAccess, what: string): void {
  if (access.space) throw forbidden(`${what} is not available in Space channels`);
}
