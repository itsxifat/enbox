import { describe, expect, it } from 'vitest';
import { extractMentionIds } from '@enbox/shared';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  insertMention,
  matchesMentionQuery,
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
