/**
 * Reactions on the client, Discord's model (several per user, one per emoji): emoji identity,
 * my reactions, the optimistic / delta updates of a message's reaction fields, who may do
 * what, and the tooltip sentence. Pure (unit-tested); the server rules are
 * apps/server/src/modules/messages/reactions.ts.
 */
import {
  PERM,
  QUICK_REACTIONS,
  hasPerm,
  isSpaceChatType,
  parseCustomEmoji,
  type ChatSummary,
  type ID,
  type Message,
  type ReactionSummary,
} from '@enbox/shared';

const stripVs16 = (s: string) => s.replace(/️/g, '');
const QUICK = new Set(QUICK_REACTIONS.map(stripVs16));

/** The same reaction: identical, the same custom emoji (by id), or equal but for VS16. */
export function sameReaction(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = parseCustomEmoji(a);
  const cb = parseCustomEmoji(b);
  if (ca || cb) return !!ca && !!cb && ca.id === cb.id;
  return stripVs16(a) === stripVs16(b);
}

/** A stable key for an emoji (custom emoji by id). */
export function reactionKey(emoji: string): string {
  return parseCustomEmoji(emoji)?.id ?? stripVs16(emoji);
}

/** `:name:` for a custom emoji, the emoji itself otherwise. */
export function reactionLabel(emoji: string): string {
  const custom = parseCustomEmoji(emoji);
  return custom ? `:${custom.name}:` : emoji;
}

/**
 * Reactor lists come with the message (`ReactionSummary.userIds`) in direct chats and groups
 * only: broadcast channels are anonymous and Space channels send counts (lists are fetched).
 */
export function reactorsListed(chat: Pick<ChatSummary, 'type'>): boolean {
  return chat.type !== 'channel' && !isSpaceChatType(chat.type);
}

/** Broadcast channels never reveal who reacted (no reactor list at all). */
export function reactorsHidden(chat: Pick<ChatSummary, 'type'>): boolean {
  return chat.type === 'channel';
}

export type ReactionFields = Pick<Message, 'reactions' | 'myReactions' | 'myReaction'>;

/** My reactions: `myReactions`, else the older `myReaction`, else derived from the lists. */
export function myReactionsOf(
  m: Pick<Message, 'reactions' | 'myReactions' | 'myReaction'>,
  me: ID | null | undefined,
): string[] {
  if (m.myReactions) return m.myReactions;
  if (m.myReaction !== undefined) return m.myReaction ? [m.myReaction] : [];
  if (!me) return [];
  return m.reactions.filter((r) => r.userIds.includes(me)).map((r) => r.emoji);
}

export function isMyReaction(
  m: Pick<Message, 'reactions' | 'myReactions' | 'myReaction'>,
  me: ID | null | undefined,
  emoji: string,
): boolean {
  return myReactionsOf(m, me).some((e) => sameReaction(e, emoji));
}

export interface ReactionChange {
  emoji: string;
  userId: ID;
  /** true: added, false: removed. */
  add: boolean;
}

/**
 * The reaction fields after one change (optimistic or a delta event), or null when it changes
 * nothing: my own echo of an optimistic update, a duplicate, a removal of something unknown.
 * `listed` (direct chats, groups): `userIds` are the truth and the count follows them; else
 * counts only, and someone else's removal never takes a count below my own reaction.
 */
export function applyReactionChange(
  m: ReactionFields,
  change: ReactionChange,
  opts: { me: ID | null | undefined; listed: boolean },
): ReactionFields | null {
  const mineBefore = myReactionsOf(m, opts.me);
  const isMe = !!opts.me && change.userId === opts.me;
  const hadMine = mineBefore.some((e) => sameReaction(e, change.emoji));
  const idx = m.reactions.findIndex((r) => sameReaction(r.emoji, change.emoji));
  const summary = idx >= 0 ? m.reactions[idx] : undefined;

  if (isMe) {
    // My own echo, or nothing to do.
    if (hadMine === change.add) return null;
  } else if (opts.listed) {
    if (!!summary?.userIds.includes(change.userId) === change.add) return null;
  } else if (!change.add && (!summary || summary.count <= (hadMine ? 1 : 0))) {
    return null;
  }

  let next: ReactionSummary | null;
  if (opts.listed) {
    const before = summary?.userIds ?? [];
    const userIds = change.add
      ? before.includes(change.userId)
        ? before
        : [...before, change.userId]
      : before.filter((u) => u !== change.userId);
    next = userIds.length
      ? { ...(summary ?? newSummary(change.emoji)), userIds, count: userIds.length }
      : null;
  } else {
    const count = (summary?.count ?? 0) + (change.add ? 1 : -1);
    next = count > 0 ? { ...(summary ?? newSummary(change.emoji)), userIds: [], count } : null;
  }
  const reactions =
    idx === -1
      ? next
        ? [...m.reactions, next]
        : m.reactions
      : next
        ? m.reactions.map((r, i) => (i === idx ? next! : r))
        : m.reactions.filter((_, i) => i !== idx);

  const stored = summary?.emoji ?? change.emoji;
  const myReactions = !isMe
    ? mineBefore
    : change.add
      ? [...mineBefore, stored]
      : mineBefore.filter((e) => !sameReaction(e, change.emoji));
  return { reactions, myReactions, myReaction: myReactions[0] ?? null };
}

function newSummary(emoji: string): ReactionSummary {
  const emojiId = parseCustomEmoji(emoji)?.id;
  return { emoji, ...(emojiId ? { emojiId } : {}), count: 0, userIds: [] };
}

/** After `message:reactions-cleared`: one emoji (`emoji`) or all of them (null) gone. */
export function applyReactionsCleared(
  m: ReactionFields,
  emoji: string | null,
  me: ID | null | undefined,
): ReactionFields | null {
  const mine = myReactionsOf(m, me);
  const keep = (e: string) => emoji !== null && !sameReaction(e, emoji);
  const reactions = m.reactions.filter((r) => keep(r.emoji));
  const myReactions = mine.filter(keep);
  if (reactions.length === m.reactions.length && myReactions.length === mine.length) return null;
  return { reactions, myReactions, myReaction: myReactions[0] ?? null };
}

// ---------------------------------------------------------------------------
// Rights (the server decides; these hide what it would refuse)
// ---------------------------------------------------------------------------

/** I may add an emoji that is not on the message yet (joining one needs no more than seeing it). */
export function canAddNewReaction(chat: ChatSummary): boolean {
  if (chat.type === 'channel') return chat.channelSettings?.reactions !== 'none';
  if (isSpaceChatType(chat.type)) return hasPerm(chat.spacePermissions, PERM.ADD_REACTIONS);
  return true;
}

/** Quick-only broadcast channels accept QUICK_REACTIONS only. */
export function reactionAllowed(chat: ChatSummary, emoji: string): boolean {
  if (chat.type !== 'channel') return true;
  const mode = chat.channelSettings?.reactions ?? 'all';
  return mode === 'all' || (mode === 'quick' && QUICK.has(stripVs16(emoji)));
}

/** Moderators remove other people's reactions (MANAGE_MESSAGES / chat admins). */
export function canModerateReactions(chat: ChatSummary): boolean {
  return (
    chat.membership === 'active' &&
    chat.type !== 'direct' &&
    chat.permissions.canDeleteForEveryoneAsAdmin
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/**
 * Discord's chip tooltip: "Ann reacted with :x:", "Ann and Bo …", "Ann, Bo and Cy …", and
 * past three "Ann, Bo and 3 others reacted with :x:". `names`: the first reactors in order
 * (fewer than `count` is fine; none → "4 people reacted with :x:").
 */
export function reactorsSentence(names: readonly string[], count: number, emoji: string): string {
  if (count <= 0) return '';
  const shown = names.slice(0, Math.min(count, count <= 3 ? 3 : 2));
  const others = count - shown.length;
  let who: string;
  if (shown.length === 0) who = `${count} ${count === 1 ? 'person' : 'people'}`;
  else if (others > 0) who = `${shown.join(', ')} and ${others} other${others === 1 ? '' : 's'}`;
  else if (shown.length === 1) who = shown[0]!;
  else who = `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)!}`;
  return `${who} reacted with ${reactionLabel(emoji)}`;
}
