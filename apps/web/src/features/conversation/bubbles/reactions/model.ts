/**
 * Reactions on the client, Discord's model (several per user, one per emoji and kind): emoji
 * identity, my reactions, the optimistic / delta updates of a message's reaction fields, who
 * may do what, and the tooltip sentence. Super reactions are the second kind: a summary's
 * `count` includes its `burstCount`, so its normal chip shows `count - burstCount`. Pure
 * (unit-tested); the server rules are apps/server/src/modules/messages/reactions.ts.
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

/** Super reactions of an emoji. */
export function burstCountOf(r: Pick<ReactionSummary, 'burstCount'>): number {
  return r.burstCount ?? 0;
}

/** Normal reactions of an emoji (`count` includes the super ones). */
export function normalCountOf(r: Pick<ReactionSummary, 'count' | 'burstCount'>): number {
  return r.count - burstCountOf(r);
}

/** The `lib/arrivals` mark of a super reaction that just came in (its chip plays the burst). */
export function superArrivalKey(messageId: ID, emoji: string): string {
  return `burst|${messageId}|${reactionKey(emoji)}`;
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

export type ReactionFields = Pick<
  Message,
  'reactions' | 'myReactions' | 'myReaction' | 'myBurstReactions'
>;

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

/** My super reactions: `myBurstReactions`, else derived from the lists. */
export function myBurstReactionsOf(
  m: Pick<Message, 'reactions' | 'myBurstReactions'>,
  me: ID | null | undefined,
): string[] {
  if (m.myBurstReactions) return m.myBurstReactions;
  if (!me) return [];
  return m.reactions.filter((r) => r.burstUserIds?.includes(me)).map((r) => r.emoji);
}

export function isMyBurstReaction(
  m: Pick<Message, 'reactions' | 'myBurstReactions'>,
  me: ID | null | undefined,
  emoji: string,
): boolean {
  return myBurstReactionsOf(m, me).some((e) => sameReaction(e, emoji));
}

export interface ReactionChange {
  emoji: string;
  userId: ID;
  /** true: added, false: removed. */
  add: boolean;
  /** A super reaction (absent: a normal one). */
  burst?: boolean;
}

/**
 * The reaction fields after one change (optimistic or a delta event), or null when it changes
 * nothing: my own echo of an optimistic update, a duplicate, a removal of something unknown.
 * Each kind of an emoji changes on its own and the summary goes when both are gone.
 * `listed` (direct chats, groups): `userIds` / `burstUserIds` are the truth and the counts
 * follow them; else counts only, and someone else's removal never takes a count below my own
 * reaction.
 */
export function applyReactionChange(
  m: ReactionFields,
  change: ReactionChange,
  opts: { me: ID | null | undefined; listed: boolean },
): ReactionFields | null {
  const burst = !!change.burst;
  const myNormal = myReactionsOf(m, opts.me);
  const myBurst = myBurstReactionsOf(m, opts.me);
  const mineBefore = burst ? myBurst : myNormal;
  const isMe = !!opts.me && change.userId === opts.me;
  const hadMine = mineBefore.some((e) => sameReaction(e, change.emoji));
  const idx = m.reactions.findIndex((r) => sameReaction(r.emoji, change.emoji));
  const summary = idx >= 0 ? m.reactions[idx] : undefined;
  // The kind that changes: its reactors (listed chats) and its count.
  const before = (burst ? summary?.burstUserIds : summary?.userIds) ?? [];
  const count = summary ? (burst ? burstCountOf(summary) : normalCountOf(summary)) : 0;

  if (isMe) {
    // My own echo, or nothing to do.
    if (hadMine === change.add) return null;
  } else if (opts.listed) {
    if (before.includes(change.userId) === change.add) return null;
  } else if (!change.add && count <= (hadMine ? 1 : 0)) {
    return null;
  }

  const ids = !opts.listed
    ? []
    : change.add
      ? before.includes(change.userId)
        ? before
        : [...before, change.userId]
      : before.filter((u) => u !== change.userId);
  const changed = opts.listed ? ids.length : Math.max(0, count + (change.add ? 1 : -1));
  const other = summary ? (burst ? normalCountOf(summary) : burstCountOf(summary)) : 0;
  const normal = burst ? { count: other, ids: summary?.userIds ?? [] } : { count: changed, ids };
  const supers = burst
    ? { count: changed, ids }
    : { count: other, ids: summary?.burstUserIds ?? [] };

  let next: ReactionSummary | null = null;
  if (normal.count + supers.count > 0) {
    const { burstCount: _count, burstUserIds: _ids, ...base } = summary ?? newSummary(change.emoji);
    next = {
      ...base,
      count: normal.count + supers.count,
      userIds: opts.listed ? normal.ids : [],
      ...(supers.count > 0 ? { burstCount: supers.count } : {}),
      ...(opts.listed && supers.ids.length ? { burstUserIds: supers.ids } : {}),
    };
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
  const mineAfter = !isMe
    ? mineBefore
    : change.add
      ? [...mineBefore, stored]
      : mineBefore.filter((e) => !sameReaction(e, change.emoji));
  const myReactions = burst ? myNormal : mineAfter;
  return {
    reactions,
    myReactions,
    myReaction: myReactions[0] ?? null,
    ...withMyBursts(m, burst ? mineAfter : myBurst),
  };
}

function newSummary(emoji: string): ReactionSummary {
  const emojiId = parseCustomEmoji(emoji)?.id;
  return { emoji, ...(emojiId ? { emojiId } : {}), count: 0, userIds: [] };
}

/** `myBurstReactions` when the message had it or I have some (absent: derived from lists). */
function withMyBursts(
  m: Pick<Message, 'myBurstReactions'>,
  mine: string[],
): Pick<Message, 'myBurstReactions'> {
  return m.myBurstReactions !== undefined || mine.length ? { myBurstReactions: mine } : {};
}

/** After `message:reactions-cleared`: one emoji (`emoji`, both kinds) or all of them (null) gone. */
export function applyReactionsCleared(
  m: ReactionFields,
  emoji: string | null,
  me: ID | null | undefined,
): ReactionFields | null {
  const mine = myReactionsOf(m, me);
  const mineBurst = myBurstReactionsOf(m, me);
  const keep = (e: string) => emoji !== null && !sameReaction(e, emoji);
  const reactions = m.reactions.filter((r) => keep(r.emoji));
  const myReactions = mine.filter(keep);
  const myBurstReactions = mineBurst.filter(keep);
  if (
    reactions.length === m.reactions.length &&
    myReactions.length === mine.length &&
    myBurstReactions.length === mineBurst.length
  )
    return null;
  return {
    reactions,
    myReactions,
    myReaction: myReactions[0] ?? null,
    ...withMyBursts(m, myBurstReactions),
  };
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
