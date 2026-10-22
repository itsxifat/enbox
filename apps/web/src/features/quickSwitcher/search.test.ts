import { describe, expect, it } from 'vitest';
import { readRecents, recordVisit, visitKeyOf } from './recents';
import { parseQuery, rankItems, scoreMatch, type SwitcherItem } from './search';
import { stepThrough } from './KeyboardShortcuts';

const item = (p: Partial<SwitcherItem> & Pick<SwitcherItem, 'key' | 'kind' | 'title'>): SwitcherItem => ({
  subtitle: null,
  path: `/x/${p.key}`,
  unread: false,
  mentions: 0,
  ...p,
});

const ITEMS: SwitcherItem[] = [
  item({ key: 'chat:general', kind: 'text', title: 'general', subtitle: 'Gamers' }),
  item({ key: 'chat:gen-art', kind: 'text', title: 'generative-art', subtitle: 'Art' }),
  item({ key: 'chat:lounge', kind: 'voice', title: 'General Lounge' }),
  item({ key: 'chat:alice', kind: 'dm', title: 'Alice', subtitle: '@alice' }),
  item({ key: 'user:bob', kind: 'user', title: 'Bob Stone', subtitle: '@bobby', path: null }),
  item({ key: 'space:gamers', kind: 'space', title: 'Gamers' }),
];

describe('quick switcher ranking', () => {
  it('parses the scope prefixes', () => {
    expect(parseQuery('@al')).toEqual({ text: 'al', only: ['dm', 'user'] });
    expect(parseQuery('#gen').only).toEqual(['text']);
    expect(parseQuery('!lo').only).toEqual(['voice']);
    expect(parseQuery('*ga').only).toEqual(['space']);
    expect(parseQuery('  Café ')).toEqual({ text: 'cafe', only: null });
  });

  it('scores exact > prefix > word prefix > substring > letters in order', () => {
    const s = (t: string) => scoreMatch(t, 'gen');
    expect(scoreMatch('gen', 'gen')).toBeGreaterThan(s('general'));
    expect(s('general')).toBeGreaterThan(s('the general'));
    expect(s('the general')).toBeGreaterThan(s('regenerate'));
    expect(s('regenerate')).toBeGreaterThan(scoreMatch('green moon', 'gen'));
    expect(scoreMatch('xyz', 'gen')).toBe(0);
  });

  it('ranks matches and honours the prefix scope', () => {
    expect(rankItems(ITEMS, 'gen', []).map((i) => i.key)).toEqual(['chat:general', 'chat:lounge', 'chat:gen-art']);
    expect(rankItems(ITEMS, '#gen', []).map((i) => i.key)).toEqual(['chat:general', 'chat:gen-art']);
    expect(rankItems(ITEMS, '!gen', []).map((i) => i.key)).toEqual(['chat:lounge']);
    expect(rankItems(ITEMS, '*', []).map((i) => i.key)).toEqual(['space:gamers']);
  });

  it('finds people by username too', () => {
    expect(rankItems(ITEMS, '@bobby', []).map((i) => i.key)).toEqual(['user:bob']);
  });

  it('boosts recent and mentioned places', () => {
    const items = [...ITEMS, item({ key: 'chat:gen-2', kind: 'text', title: 'general', mentions: 2 })];
    expect(rankItems(items, 'general', [])[0]!.key).toBe('chat:gen-2');
    expect(rankItems(ITEMS, 'gen', ['chat:gen-art'])[0]!.key).toBe('chat:gen-art');
  });

  it('lists recents, then unread, for an empty query', () => {
    const items = ITEMS.map((i) => (i.key === 'chat:alice' ? { ...i, unread: true } : i));
    expect(rankItems(items, '', ['chat:lounge', 'chat:general']).map((i) => i.key)).toEqual([
      'chat:lounge',
      'chat:general',
      'chat:alice',
    ]);
  });
});

describe('recents', () => {
  it('records visits most recent first, without duplicates', () => {
    recordVisit('chat:a');
    recordVisit('chat:b');
    recordVisit('chat:a');
    expect(readRecents()).toEqual(['chat:a', 'chat:b']);
  });

  it('maps app paths to keys', () => {
    const id = '0190d2a4-3c4b-7d2e-9f10-a1b2c3d4e5f6';
    const other = '0190d2a4-3c4b-7d2e-9f10-a1b2c3d4e5f7';
    expect(visitKeyOf(`/spaces/${id}/${other}`)).toBe(`chat:${other}`);
    expect(visitKeyOf(`/spaces/${id}`)).toBe(`space:${id}`);
    expect(visitKeyOf(`/chats/${id}`)).toBe(`chat:${id}`);
    expect(visitKeyOf('/settings/profile')).toBeNull();
  });
});

describe('stepThrough', () => {
  it('wraps around and can skip to the next match', () => {
    expect(stepThrough([1, 2, 3], 2, 1)).toBe(1);
    expect(stepThrough([1, 2, 3], 0, -1)).toBe(3);
    expect(stepThrough([1, 2, 3, 4], 0, 1, (n) => n % 2 === 0)).toBe(2);
    expect(stepThrough([1, 3], 0, 1, (n) => n % 2 === 0)).toBeUndefined();
  });
});
