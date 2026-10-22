import { describe, expect, it } from 'vitest';
import {
  activeWord,
  addToken,
  formatDay,
  isEmptyQuery,
  parseDay,
  parseQuery,
  replaceWord,
  searchWords,
  serializeQuery,
  toApiQuery,
} from './query';
import { buildSuggestions } from './suggestions';
import { groupResults, pageCount, pageList, resultCountLabel } from './SearchResultsPanel';
import type { MessageSearchResult } from '@enbox/shared';
import { makeMessage } from '@/test/factories';

const ALICE = '0190d2a4-3c4b-7d2e-9f10-00000000000a';
const GENERAL = '0190d2a4-3c4b-7d2e-9f10-0000000000c1';

/** Local midnight of a day, as the ISO string the API gets. */
const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

describe('search query: chips to the API query', () => {
  it('serializes chips first, then the words, and parses the string back', () => {
    const q = {
      tokens: [
        { key: 'from' as const, value: ALICE },
        { key: 'has' as const, value: 'link' },
        { key: 'in' as const, value: GENERAL },
      ],
      text: '  hello   world ',
    };
    const s = serializeQuery(q);
    expect(s).toBe(`from:${ALICE} has:link in:${GENERAL} hello world`);
    expect(parseQuery(s)).toEqual({ tokens: q.tokens, text: 'hello world' });
  });

  it('keeps invalid or unknown filters as words, and typed valid ones as chips', () => {
    expect(parseQuery('from:alice has:gif when:now HAS:Image before:2026-02-30 pinned:TRUE hi')).toEqual({
      tokens: [
        { key: 'has', value: 'image' },
        { key: 'pinned', value: 'true' },
      ],
      text: 'from:alice has:gif when:now before:2026-02-30 hi',
    });
  });

  it('one value per key except has (deduplicated)', () => {
    let tokens = addToken([], { key: 'from', value: 'a' });
    tokens = addToken(tokens, { key: 'has', value: 'link' });
    tokens = addToken(tokens, { key: 'from', value: 'b' });
    tokens = addToken(tokens, { key: 'has', value: 'image' });
    tokens = addToken(tokens, { key: 'has', value: 'link' });
    expect(tokens).toEqual([
      { key: 'has', value: 'link' },
      { key: 'from', value: 'b' },
      { key: 'has', value: 'image' },
    ]);
  });

  it('maps chips to the API query: people, channel, has (embed = link), pinned', () => {
    const q = parseQuery(`from:${ALICE} mentions:${ALICE} in:${GENERAL} has:embed has:link has:sound pinned:false  quokka  `);
    expect(toApiQuery(q, 'space')).toEqual({
      q: 'quokka',
      authorId: ALICE,
      mentions: ALICE,
      channelId: GENERAL,
      has: ['link', 'sound'],
      pinned: 'false',
    });
    // `in:` means nothing in a DM.
    expect(toApiQuery(parseQuery(`in:${GENERAL} hi`), 'chat')).toEqual({ q: 'hi' });
    expect(toApiQuery(parseQuery(''), 'chat')).toEqual({});
  });

  it('dates are local calendar days: before = its start, after = from the next day, during = that day; they intersect', () => {
    expect(toApiQuery(parseQuery('before:2026-03-10'), 'chat')).toEqual({ before: midnight(2026, 3, 10) });
    expect(toApiQuery(parseQuery('after:2026-03-10'), 'chat')).toEqual({ after: midnight(2026, 3, 11) });
    expect(toApiQuery(parseQuery('during:2026-12-31'), 'chat')).toEqual({
      after: midnight(2026, 12, 31),
      before: midnight(2027, 1, 1),
    });
    expect(toApiQuery(parseQuery('during:2026-03-10 before:2026-03-20 after:2026-03-01'), 'chat')).toEqual({
      after: midnight(2026, 3, 10),
      before: midnight(2026, 3, 11),
    });
    expect(parseDay('2026-02-29')).toBeNull();
    expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('limits the words to the server maximum and knows an empty query', () => {
    expect(toApiQuery(parseQuery('x'.repeat(300)), 'chat').q).toHaveLength(200);
    expect(isEmptyQuery(parseQuery('   '))).toBe(true);
    expect(isEmptyQuery(parseQuery('pinned:true'))).toBe(false);
    expect(searchWords('a Quokka quokka bb')).toEqual(['Quokka', 'bb', 'a']);
  });

  it('finds the filter at the caret and replaces it', () => {
    const text = 'hello from:al world';
    const w = activeWord(text, 13);
    expect(w).toEqual({ key: 'from', partial: 'al', start: 6, end: 13 });
    expect(replaceWord(text, w, '')).toEqual({ text: 'hello world', caret: 6 });
    expect(activeWord('hello fr', 8)).toEqual({ key: null, partial: 'fr', start: 6, end: 8 });
    expect(replaceWord('hello fr', activeWord('hello fr', 8), 'from:')).toEqual({ text: 'hello from:', caret: 11 });
    expect(activeWord('', 0)).toEqual({ key: null, partial: '', start: 0, end: 0 });
  });
});

describe('search suggestions', () => {
  const base = { scopeKind: 'space' as const, empty: true, people: [], channels: [], recents: [] };

  it('lists the filters (in: only in Spaces), narrowed by the typed word, then the history', () => {
    const all = buildSuggestions({ ...base, word: activeWord('', 0), recents: ['hello'] });
    expect(all.map((s) => s.title)).toEqual(['Search Options', 'History']);
    expect(all[0]!.items.map((i) => (i.type === 'key' ? i.key : ''))).toEqual([
      'from',
      'mentions',
      'has',
      'before',
      'during',
      'after',
      'in',
      'pinned',
    ]);
    const dm = buildSuggestions({ ...base, scopeKind: 'chat', word: activeWord('', 0) });
    expect(dm[0]!.items.some((i) => i.type === 'key' && i.key === 'in')).toBe(false);
    const narrowed = buildSuggestions({ ...base, empty: false, word: activeWord('m', 1), recents: ['x'] });
    expect(narrowed.map((s) => s.items.map((i) => i.id))).toEqual([['key-mentions']]);
  });

  it('offers values for the filter being typed', () => {
    const people = [{ id: ALICE, name: 'Alice', username: 'alice' }];
    const from = buildSuggestions({ ...base, word: activeWord('from:al', 7), people });
    expect(from).toEqual([
      {
        id: 'from',
        title: 'From User',
        items: [{ type: 'token', id: `from-${ALICE}`, token: { key: 'from', value: ALICE }, label: 'Alice', detail: 'alice' }],
      },
    ]);
    const has = buildSuggestions({ ...base, word: activeWord('has:i', 5) });
    expect(has[0]!.items.map((i) => (i.type === 'token' ? i.token.value : ''))).toEqual(['image']);
    const pinned = buildSuggestions({ ...base, word: activeWord('pinned:', 7) });
    expect(pinned[0]!.items.map((i) => i.id)).toEqual(['pinned-true', 'pinned-false']);
  });

  it('dates: the typed day, today, yesterday and a picker', () => {
    const today = new Date(2026, 9, 23);
    const s = buildSuggestions({ ...base, word: activeWord('before:', 7), today });
    expect(s[0]!.items.map((i) => (i.type === 'token' ? [i.label, i.token.value] : [i.type]))).toEqual([
      ['Today', '2026-10-23'],
      ['Yesterday', '2026-10-22'],
      ['date-picker'],
    ]);
    const typed = buildSuggestions({ ...base, word: activeWord('after:2026-01-02', 16), today });
    expect(typed[0]!.items.map((i) => i.id)).toEqual(['after-2026-01-02', 'after-picker']);
  });
});

describe('search results helpers', () => {
  const r = (id: string, chatId: string): MessageSearchResult => ({
    message: makeMessage({ id, chatId }),
    chat: { id: chatId, type: 'space_text', name: chatId, avatarUrl: null, peer: null },
  });

  it('groups consecutive results of a channel (the sort order stays)', () => {
    const groups = groupResults([r('1', 'a'), r('2', 'a'), r('3', 'b'), r('4', 'a')]);
    expect(groups.map((g) => [g.chat.id, g.items.map((i) => i.message.id)])).toEqual([
      ['a', ['1', '2']],
      ['b', ['3']],
      ['a', ['4']],
    ]);
  });

  it('pages: first, last and the neighbours of the current one', () => {
    expect(pageList(0, 3)).toEqual([0, 1, 2]);
    expect(pageList(0, 10)).toEqual([0, 1, 2, 3, 'gap', 9]);
    expect(pageList(5, 10)).toEqual([0, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pageList(9, 10)).toEqual([0, 'gap', 6, 7, 8, 9]);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(5000)).toBe(200);
    expect(resultCountLabel(1, false)).toBe('1 Result');
    expect(resultCountLabel(5000, true)).toBe(`${(5000).toLocaleString()}+ Results`);
  });
});
