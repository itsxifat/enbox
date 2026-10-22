import { afterEach, describe, expect, it, vi } from 'vitest';
import { recentReactions, rememberReaction } from './recent';

describe('recent reactions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts from the defaults and moves what I use to the front', () => {
    expect(recentReactions(3)).toEqual(['👍', '❤️', '😂']);
    rememberReaction('🔥');
    rememberReaction('🎉');
    rememberReaction('❤'); // the same heart (no VS16): moved, not duplicated
    expect(recentReactions(3)).toEqual(['❤', '🎉', '🔥']);
    expect(recentReactions(5)).toEqual(['❤', '🎉', '🔥', '👍', '😂']);
  });

  it('works without storage (private mode, quota)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => rememberReaction('🔥')).not.toThrow();
    expect(recentReactions(3)).toEqual(['👍', '❤️', '😂']);
  });

  it('ignores junk in storage', () => {
    localStorage.setItem('enbox:recent-reactions', '{"not":"a list"}');
    expect(recentReactions(2)).toEqual(['👍', '❤️']);
    localStorage.setItem('enbox:recent-reactions', '[1, "🔥", null]');
    expect(recentReactions(2)).toEqual(['🔥', '👍']);
  });
});
