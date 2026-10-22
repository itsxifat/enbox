import { describe, expect, it } from 'vitest';
import type { ReactionSummary } from '@enbox/shared';
import {
  applyReactionChange,
  applyReactionsCleared,
  myReactionsOf,
  reactionLabel,
  reactorsSentence,
  sameReaction,
  type ReactionFields,
} from './model';

const CUSTOM = '<:party:0f6c9a52-3b8e-4c1d-9e2f-7a6b5c4d3e21>';

function fields(reactions: ReactionSummary[], myReactions: string[] = []): ReactionFields {
  return { reactions, myReactions, myReaction: myReactions[0] ?? null };
}

describe('reaction identity', () => {
  it('matches VS16 variants and custom emoji by id', () => {
    expect(sameReaction('❤', '❤️')).toBe(true);
    expect(sameReaction('👍', '👎')).toBe(false);
    expect(sameReaction(CUSTOM, '<:renamed:0f6c9a52-3b8e-4c1d-9e2f-7a6b5c4d3e21>')).toBe(true);
    expect(sameReaction(CUSTOM, ':party:')).toBe(false);
    expect(reactionLabel(CUSTOM)).toBe(':party:');
    expect(reactionLabel('👍')).toBe('👍');
  });

  it('reads my reactions from myReactions, the older myReaction, or the lists', () => {
    const r = [{ emoji: '👍', count: 1, userIds: ['me'] }];
    expect(myReactionsOf({ reactions: r, myReactions: ['🎉'] }, 'me')).toEqual(['🎉']);
    expect(myReactionsOf({ reactions: r, myReaction: null }, 'me')).toEqual([]);
    expect(myReactionsOf({ reactions: r }, 'me')).toEqual(['👍']);
  });
});

describe('applyReactionChange (optimistic updates and delta events)', () => {
  const listed = { me: 'me', listed: true };
  const counts = { me: 'me', listed: false };

  it('adds and removes others in listed chats, ignoring duplicates', () => {
    const m = fields([{ emoji: '👍', count: 1, userIds: ['ann'] }]);
    const added = applyReactionChange(m, { emoji: '👍', userId: 'bo', add: true }, listed)!;
    expect(added.reactions).toEqual([{ emoji: '👍', count: 2, userIds: ['ann', 'bo'] }]);
    expect(applyReactionChange(added, { emoji: '👍', userId: 'bo', add: true }, listed)).toBeNull();
    const removed = applyReactionChange(added, { emoji: '👍', userId: 'ann', add: false }, listed)!;
    expect(removed.reactions).toEqual([{ emoji: '👍', count: 1, userIds: ['bo'] }]);
    expect(
      applyReactionChange(removed, { emoji: '🎉', userId: 'ann', add: false }, listed),
    ).toBeNull();
    const gone = applyReactionChange(removed, { emoji: '👍', userId: 'bo', add: false }, listed)!;
    expect(gone.reactions).toEqual([]);
  });

  it('appends a new emoji at the end (first-reaction order) with its custom emoji id', () => {
    const m = fields([{ emoji: '👍', count: 3, userIds: [] }]);
    const next = applyReactionChange(m, { emoji: CUSTOM, userId: 'ann', add: true }, counts)!;
    expect(next.reactions).toEqual([
      { emoji: '👍', count: 3, userIds: [] },
      { emoji: CUSTOM, emojiId: '0f6c9a52-3b8e-4c1d-9e2f-7a6b5c4d3e21', count: 1, userIds: [] },
    ]);
  });

  it('my own echo of an optimistic change is a no-op; my other devices update my reactions', () => {
    const m = fields([{ emoji: '👍', count: 2, userIds: [] }], ['👍']);
    // Echo: already mine.
    expect(applyReactionChange(m, { emoji: '👍', userId: 'me', add: true }, counts)).toBeNull();
    // Another device removed it.
    const removed = applyReactionChange(m, { emoji: '👍', userId: 'me', add: false }, counts)!;
    expect(removed).toEqual({
      reactions: [{ emoji: '👍', count: 1, userIds: [] }],
      myReactions: [],
      myReaction: null,
    });
    // Another device added an equivalent emoji: it joins under the stored form.
    const heart = applyReactionChange(
      fields([{ emoji: '❤️', count: 1, userIds: [] }]),
      { emoji: '❤', userId: 'me', add: true },
      counts,
    )!;
    expect(heart).toEqual({
      reactions: [{ emoji: '❤️', count: 2, userIds: [] }],
      myReactions: ['❤️'],
      myReaction: '❤️',
    });
  });

  it('counts only: someone else never takes a count below my own reaction', () => {
    const m = fields([{ emoji: '👍', count: 1, userIds: [] }], ['👍']);
    expect(applyReactionChange(m, { emoji: '👍', userId: 'ann', add: false }, counts)).toBeNull();
    expect(applyReactionChange(m, { emoji: '🎉', userId: 'ann', add: false }, counts)).toBeNull();
    const two = applyReactionChange(m, { emoji: '👍', userId: 'ann', add: true }, counts)!;
    expect(two.reactions[0]!.count).toBe(2);
    expect(two.myReactions).toEqual(['👍']);
  });

  it('clears one emoji or all of them', () => {
    const m = fields(
      [
        { emoji: '👍', count: 2, userIds: [] },
        { emoji: '🎉', count: 1, userIds: [] },
      ],
      ['👍', '🎉'],
    );
    expect(applyReactionsCleared(m, '👍', 'me')).toEqual({
      reactions: [{ emoji: '🎉', count: 1, userIds: [] }],
      myReactions: ['🎉'],
      myReaction: '🎉',
    });
    expect(applyReactionsCleared(m, null, 'me')).toEqual({
      reactions: [],
      myReactions: [],
      myReaction: null,
    });
    expect(applyReactionsCleared(fields([]), null, 'me')).toBeNull();
  });
});

describe('reactorsSentence (chip tooltip)', () => {
  it('names up to three, then "and N others"', () => {
    expect(reactorsSentence(['Ann'], 1, '👍')).toBe('Ann reacted with 👍');
    expect(reactorsSentence(['Ann', 'Bo'], 2, '👍')).toBe('Ann and Bo reacted with 👍');
    expect(reactorsSentence(['Ann', 'Bo', 'Cy'], 3, '👍')).toBe('Ann, Bo and Cy reacted with 👍');
    expect(reactorsSentence(['Ann', 'Bo', 'Cy'], 5, CUSTOM)).toBe(
      'Ann, Bo and 3 others reacted with :party:',
    );
    expect(reactorsSentence(['You', 'Bo'], 3, '👍')).toBe('You, Bo and 1 other reacted with 👍');
    expect(reactorsSentence([], 4, '👍')).toBe('4 people reacted with 👍');
    expect(reactorsSentence([], 0, '👍')).toBe('');
  });
});
