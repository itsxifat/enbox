import { describe, expect, it } from 'vitest';
import type { Poll } from '@enbox/shared';
import { applyReaction, applyVote } from './channelApi';

describe('optimistic reactions', () => {
  const base = [
    { emoji: '👍', count: 3, userIds: [] },
    { emoji: '❤️', count: 1, userIds: [] },
  ];

  it('adds a new reaction', () => {
    expect(applyReaction(base, null, '😂')).toEqual([
      { emoji: '👍', count: 3, userIds: [] },
      { emoji: '❤️', count: 1, userIds: [] },
      { emoji: '😂', count: 1, userIds: [] },
    ]);
  });

  it('moves my reaction and drops empty entries', () => {
    expect(applyReaction(base, '❤️', '👍')).toEqual([{ emoji: '👍', count: 4, userIds: [] }]);
  });

  it('removes my reaction and is a no-op for the same emoji', () => {
    expect(applyReaction(base, '👍', null)).toEqual([
      { emoji: '👍', count: 2, userIds: [] },
      { emoji: '❤️', count: 1, userIds: [] },
    ]);
    expect(applyReaction(base, '👍', '👍')).toBe(base);
  });
});

describe('optimistic poll votes', () => {
  const poll: Poll = {
    question: 'Next?',
    allowMultiple: false,
    totalVoters: 2,
    myOptionIds: [],
    options: [
      { id: 'a', text: 'A', voteCount: 2, voterIds: [] },
      { id: 'b', text: 'B', voteCount: 0, voterIds: [] },
    ],
  };

  it('counts a first vote', () => {
    const p = applyVote(poll, ['b']);
    expect(p.options.map((o) => o.voteCount)).toEqual([2, 1]);
    expect(p.totalVoters).toBe(3);
    expect(p.myOptionIds).toEqual(['b']);
  });

  it('changes and retracts a vote', () => {
    const voted = {
      ...poll,
      totalVoters: 3,
      myOptionIds: ['a'],
      options: [
        { id: 'a', text: 'A', voteCount: 3, voterIds: [] },
        { id: 'b', text: 'B', voteCount: 0, voterIds: [] },
      ],
    };
    const changed = applyVote(voted, ['b']);
    expect(changed.options.map((o) => o.voteCount)).toEqual([2, 1]);
    expect(changed.totalVoters).toBe(3);
    const retracted = applyVote(voted, []);
    expect(retracted.options.map((o) => o.voteCount)).toEqual([2, 0]);
    expect(retracted.totalVoters).toBe(2);
  });
});
