import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/factories';
import { findPostIndex, jumpFromParams } from './feedJump';

describe('channel feed jumps', () => {
  it('reads ?m=<seq>&mid=<id> (ignores invalid seqs)', () => {
    expect(jumpFromParams(new URLSearchParams('m=12&mid=abc'))).toEqual({
      seq: 12,
      messageId: 'abc',
    });
    expect(jumpFromParams(new URLSearchParams('m=7'))).toEqual({ seq: 7, messageId: undefined });
    expect(jumpFromParams(new URLSearchParams('m=0'))).toBeNull();
    expect(jumpFromParams(new URLSearchParams('m=x'))).toBeNull();
    expect(jumpFromParams(new URLSearchParams(''))).toBeNull();
  });

  it('finds the post by id, else the first loaded post at or after its seq', () => {
    const items = [5, 6, 9].map((seq) => makeMessage({ id: `p${seq}`, seq }));
    expect(findPostIndex(items, { seq: 6, messageId: 'p9' })).toBe(2);
    expect(findPostIndex(items, { seq: 7 })).toBe(2); // 7 was deleted/expired: the next one
    expect(findPostIndex(items, { seq: 5, messageId: 'gone' })).toBe(0);
    expect(findPostIndex(items, { seq: 10 })).toBe(-1);
  });
});
