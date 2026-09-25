import { describe, expect, it } from 'vitest';
import { makeUser } from '@/test/factories';
import { buildSections, isRemoteQuery, matchesUser } from './candidates';

const me = makeUser({ displayName: 'Me Myself' });
const ana = makeUser({ displayName: 'Ana Álvarez', username: 'ana_a' });
const bob = makeUser({ displayName: 'Bob Stone', username: 'bobby', contactName: 'Bobby S' });
const cyd = makeUser({ displayName: 'Cyd Charisse', username: 'cyd' });
const gone = makeUser({ displayName: 'Deleted account', isDeleted: true });

describe('people picker candidates', () => {
  it('matches names, saved names and usernames without accents or @', () => {
    expect(matchesUser(ana, 'alva')).toBe(true);
    expect(matchesUser(ana, '@ana_')).toBe(true);
    expect(matchesUser(bob, 'bobby s')).toBe(true);
    expect(matchesUser(bob, 'zed')).toBe(false);
    expect(matchesUser(cyd, '')).toBe(true);
  });

  it('only searches the server for 3+ chars or phone numbers', () => {
    expect(isRemoteQuery('ab')).toBe(false);
    expect(isRemoteQuery('@ab')).toBe(false);
    expect(isRemoteQuery('abc')).toBe(true);
    expect(isRemoteQuery('+1 555 123 4567')).toBe(true);
  });

  it('builds de-duplicated sections, excluding me and deleted accounts', () => {
    const sections = buildSections({
      contacts: [cyd, ana, me],
      peers: [ana, bob, gone],
      results: [bob, cyd, makeUser({ id: 'x', displayName: 'Xena' })],
      query: '',
      meId: me.id,
    });
    expect(sections.map((s) => s.id)).toEqual(['contacts', 'recent', 'search']);
    expect(sections[0]!.users.map((u) => u.displayName)).toEqual(['Ana Álvarez', 'Cyd Charisse']);
    expect(sections[1]!.users).toEqual([bob]);
    expect(sections[2]!.users.map((u) => u.id)).toEqual(['x']);
  });

  it('filters local sections by the query but keeps server results', () => {
    const sections = buildSections({
      contacts: [ana, cyd],
      peers: [bob],
      results: [makeUser({ id: 'y', displayName: 'Anything' })],
      query: 'cyd',
      meId: null,
    });
    expect(sections.map((s) => [s.id, s.users.length])).toEqual([
      ['contacts', 1],
      ['search', 1],
    ]);
  });
});
