import { describe, expect, it } from 'vitest';
import { extractMentionIds } from '@enbox/shared';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  insertMention,
  matchesMentionQuery,
  pickEmoji,
  pruneRefs,
} from './composerMentions';

const MAYA = '11111111-1111-4111-8111-111111111111';
const MAYA_P = '22222222-2222-4222-8222-222222222222';
const names: Record<string, string> = { [MAYA]: 'Maya', [MAYA_P]: 'Maya Patel' };

describe('encodeMentions', () => {
  it('turns picked "@Name" into tokens, longest names first', () => {
    const refs = [
      { userId: MAYA, name: 'Maya' },
      { userId: MAYA_P, name: 'Maya Patel' },
    ];
    const out = encodeMentions('Hi @Maya Patel and @Maya!', refs);
    expect(out).toBe(`Hi @{${MAYA_P}} and @{${MAYA}}!`);
    expect(extractMentionIds(out)).toEqual([MAYA_P, MAYA]);
  });

  it('ignores edited names, e-mails and text without refs', () => {
    const refs = [{ userId: MAYA, name: 'Maya' }];
    expect(encodeMentions('@Mayaa and bob@Maya.com', refs)).toBe('@Mayaa and bob@Maya.com');
    expect(encodeMentions('plain', [])).toBe('plain');
  });

  it('handles names with regex characters', () => {
    const refs = [{ userId: MAYA, name: 'M. (Maya)*' }];
    expect(encodeMentions('cc @M. (Maya)* ok', refs)).toBe(`cc @{${MAYA}} ok`);
  });
});

describe('decodeMentions', () => {
  it('round-trips tokens to names and back', () => {
    const tokenized = `Ping @{${MAYA_P}} and @{${MAYA}} and @{${MAYA}}`;
    const { text, refs } = decodeMentions(tokenized, (id) => names[id]!);
    expect(text).toBe('Ping @Maya Patel and @Maya and @Maya');
    expect(refs).toHaveLength(2);
    expect(encodeMentions(text, refs)).toBe(tokenized);
  });
});

describe('mention query & insertion', () => {
  it('detects the query at the caret', () => {
    expect(activeMentionQuery('hello @Ma', 9)).toEqual({ start: 6, query: 'Ma' });
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMentionQuery('mail a@b', 8)).toBeNull();
    expect(activeMentionQuery('hi @Maya Pa', 11)).toEqual({ start: 3, query: 'Maya Pa' });
    expect(activeMentionQuery('line\n@x', 7)).toEqual({ start: 5, query: 'x' });
  });

  it('inserts "@Name " replacing the query', () => {
    const q = activeMentionQuery('hey @ma how', 7)!;
    expect(insertMention('hey @ma how', q, 7, 'Maya Patel')).toEqual({
      text: 'hey @Maya Patel how',
      caret: 16,
    });
  });

  it('matches by name start or word start, accent-insensitive', () => {
    expect(matchesMentionQuery('Maya Patel', 'pat')).toBe(true);
    expect(matchesMentionQuery('Zoë Martin', 'zoe')).toBe(true);
    expect(matchesMentionQuery('Maya Patel', 'tel')).toBe(false);
  });

  it('prunes refs whose text disappeared', () => {
    const refs = [
      { userId: MAYA, name: 'Maya' },
      { userId: MAYA_P, name: 'Maya Patel' },
    ];
    expect(pruneRefs('only @Maya here', refs)).toEqual([refs[0]]);
  });
});

describe('space mention tokens', () => {
  const ROLE = '33333333-3333-4333-8333-333333333333';
  it('round-trips @everyone, @here and roles', () => {
    const text = `@{everyone} @{here} ping @{role:${ROLE}} and @{${MAYA}}`;
    const decoded = decodeMentions(text, (id) => names[id] ?? '?', () => 'mods');
    expect(decoded.text).toBe('@everyone @here ping @mods and @Maya');
    expect(decoded.refs.map((r) => r.userId)).toEqual(['everyone', 'here', `role:${ROLE}`, MAYA]);
    expect(encodeMentions(decoded.text, decoded.refs)).toBe(text);
  });
});

describe('custom emoji in the composer', () => {
  const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const ID2 = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
  const blob = `<:blob:${ID}>`;

  it('a picked custom emoji shows as :name: and is sent as its token; unicode is inserted as is', () => {
    expect(pickEmoji('🎉', [])).toEqual({ insert: '🎉', refs: [] });
    const picked = pickEmoji(blob, [{ userId: MAYA, name: 'Maya' }]);
    expect(picked.insert).toBe(':blob:');
    expect(encodeMentions('@Maya look :blob: :blob:', picked.refs)).toBe(`@{${MAYA}} look ${blob} ${blob}`);
    // Typed shortcodes without a pick stay text; a raw token in the text is left alone.
    expect(encodeMentions(':party: and :blob:', picked.refs)).toBe(`:party: and ${blob}`);
    expect(encodeMentions(`${blob}`, picked.refs)).toBe(blob);
    // The newest pick of a name wins.
    const again = pickEmoji(`<a:blob:${ID2}>`, picked.refs);
    expect(again.refs.filter((r) => r.name === 'blob')).toEqual([{ userId: `<a:blob:${ID2}>`, name: 'blob' }]);
  });

  it('round-trips drafts and edits, and prunes deleted shortcodes', () => {
    const text = `hi ${blob} @{${MAYA}}`;
    const decoded = decodeMentions(text, (id) => names[id] ?? '?');
    expect(decoded.text).toBe('hi :blob: @Maya');
    expect(encodeMentions(decoded.text, decoded.refs)).toBe(text);
    expect(pruneRefs('hi @Maya', decoded.refs)).toEqual([{ userId: MAYA, name: 'Maya' }]);
  });
});
