/** @silent: the prefix (any case, then a space or the end) unless it is a picked mention, and the @ list's offer. */
import { describe, expect, it } from 'vitest';
import { SILENT_KEY, silentCandidate, silentRest } from './silent';

describe('silentRest', () => {
  it('the text after a leading "@silent"', () => {
    expect(silentRest('@silent hello')).toBe('hello');
    expect(silentRest('@Silent   hi\nthere')).toBe('hi\nthere');
    expect(silentRest('@silent')).toBe('');
  });

  it('null without the prefix', () => {
    for (const text of ['hello @silent', '@silently', ' @silent hi', '@sil'])
      expect(silentRest(text)).toBeNull();
  });

  it('null when "@silent" is someone picked from the @ list', () => {
    expect(silentRest('@silent hi', [{ userId: 'u1', name: 'silent' }])).toBeNull();
    // A custom emoji named so is not a mention.
    expect(silentRest('@silent hi', [{ userId: '<:silent:x>', name: 'silent' }])).toBe('hi');
  });
});

describe('silentCandidate', () => {
  it('offered at the start while the query begins "silent"', () => {
    expect(silentCandidate({ start: 0, query: '' })?.key).toBe(SILENT_KEY);
    expect(silentCandidate({ start: 0, query: 'SIL' })?.name).toBe('silent');
    expect(silentCandidate({ start: 0, query: 'silent' })).not.toBeNull();
    expect(silentCandidate({ start: 0, query: 'sa' })).toBeNull();
    expect(silentCandidate({ start: 4, query: 'si' })).toBeNull();
    expect(silentCandidate(null)).toBeNull();
  });
});
