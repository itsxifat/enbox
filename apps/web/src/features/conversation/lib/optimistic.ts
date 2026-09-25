/**
 * Optimistic updates for reactions and poll votes (the REST response replaces them). Pure.
 */
import type { ID, Message, Poll, ReactionSummary } from '@enbox/shared';

/** My current reaction: the viewer-specific field when present, else derived from userIds. */
export function myReactionOf(
  m: Pick<Message, 'reactions' | 'myReaction'>,
  meId: ID,
): string | null {
  if (m.myReaction !== undefined) return m.myReaction;
  return m.reactions.find((r) => r.userIds.includes(meId))?.emoji ?? null;
}

/**
 * Set (emoji) or remove (null) my reaction. `anonymous` (channels) keeps userIds empty.
 */
export function applyReaction<M extends Pick<Message, 'reactions' | 'myReaction'>>(
  m: M,
  emoji: string | null,
  meId: ID,
  anonymous = false,
): M {
  const prev = myReactionOf(m, meId);
  let reactions: ReactionSummary[] = m.reactions.map((r) => ({ ...r, userIds: [...r.userIds] }));
  if (prev) {
    reactions = reactions
      .map((r) =>
        r.emoji === prev
          ? { ...r, count: Math.max(0, r.count - 1), userIds: r.userIds.filter((u) => u !== meId) }
          : r,
      )
      .filter((r) => r.count > 0);
  }
  if (emoji) {
    const existing = reactions.find((r) => r.emoji === emoji);
    if (existing) {
      existing.count += 1;
      if (!anonymous) existing.userIds.push(meId);
    } else reactions.push({ emoji, count: 1, userIds: anonymous ? [] : [meId] });
  }
  return { ...m, reactions, myReaction: emoji };
}

export function myVotesOf(poll: Poll, meId: ID): string[] {
  if (poll.myOptionIds) return poll.myOptionIds;
  return poll.options.filter((o) => o.voterIds.includes(meId)).map((o) => o.id);
}

/** The selection after tapping an option (single choice: select/retract; multiple: toggle). */
export function nextVoteSelection(poll: Poll, optionId: string, meId: ID): string[] {
  const mine = myVotesOf(poll, meId);
  if (poll.allowMultiple)
    return mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId];
  return mine.length === 1 && mine[0] === optionId ? [] : [optionId];
}

export function applyVote(poll: Poll, optionIds: string[], meId: ID, anonymous = false): Poll {
  const prev = new Set(myVotesOf(poll, meId));
  const next = new Set(optionIds);
  const options = poll.options.map((o) => {
    const had = prev.has(o.id);
    const has = next.has(o.id);
    if (had === has) return o;
    return {
      ...o,
      voteCount: Math.max(0, o.voteCount + (has ? 1 : -1)),
      voterIds: anonymous
        ? o.voterIds
        : has
          ? [...o.voterIds.filter((u) => u !== meId), meId]
          : o.voterIds.filter((u) => u !== meId),
    };
  });
  let totalVoters = poll.totalVoters;
  if (prev.size === 0 && next.size > 0) totalVoters += 1;
  else if (prev.size > 0 && next.size === 0) totalVoters = Math.max(0, totalVoters - 1);
  return { ...poll, options, totalVoters, myOptionIds: [...next] };
}
