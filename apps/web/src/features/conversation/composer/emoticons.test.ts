/**
 * Emoticon conversion on send: standalone emoticons become emoji (the list includes the
 * common Discord set); emoticons inside words, before punctuation, inside code, code blocks,
 * links or tokens stay as typed.
 */
import { describe, expect, it } from 'vitest';
import { EMOTICONS, convertEmoticons } from './emoticons';

const ID = '00000000-0000-4000-8000-000000000001';

describe('convertEmoticons', () => {
  it('converts each standalone emoticon', () => {
    const cases: [string, string][] = [
      [':)', '🙂'],
      [':D', '😄'],
      [';)', '😉'],
      [':(', '🙁'],
      [':P', '😛'],
      [':O', '😮'],
      ['<3', '❤️'],
      ['</3', '💔'],
      [":'(", '😢'],
      [':|', '😐'],
      ['xD', '😆'],
      ['B)', '😎'],
      [':-)', '🙂'],
      [':p', '😛'],
      ['-_-', '😑'],
    ];
    for (const [typed, emoji] of cases) expect(convertEmoticons(typed)).toBe(emoji);
    // Every entry converts on its own.
    for (const [typed, emoji] of Object.entries(EMOTICONS))
      expect(convertEmoticons(`a ${typed} b`)).toBe(`a ${emoji} b`);
  });

  it('between words, side by side and on several lines', () => {
    expect(convertEmoticons('hi :) see you :D')).toBe('hi 🙂 see you 😄');
    expect(convertEmoticons(':) :)')).toBe('🙂 🙂');
    expect(convertEmoticons('line one :(\nline two <3')).toBe('line one 🙁\nline two ❤️');
    expect(convertEmoticons('> :P')).toBe('> 😛');
  });

  it('leaves emoticons inside words, before punctuation and in times alone', () => {
    for (const text of ['a:)b', '(see notes:)', 'at 10:30', ':))', 'xDD', 'nice:D', ':).'])
      expect(convertEmoticons(text)).toBe(text);
  });

  it('never inside inline code, code blocks, links or tokens', () => {
    expect(convertEmoticons('` :) ` and :)')).toBe('` :) ` and 🙂');
    expect(convertEmoticons('```\nx :) <3\n```\n:)')).toBe('```\nx :) <3\n```\n🙂');
    // An unclosed fence protects to the end.
    expect(convertEmoticons('```\n:)')).toBe('```\n:)');
    expect(convertEmoticons('[ :) ](https://example.com) :)')).toBe(
      '[ :) ](https://example.com) 🙂',
    );
    expect(convertEmoticons('https://example.com/a :)')).toBe('https://example.com/a 🙂');
    expect(convertEmoticons(`@{${ID}} :) #{${ID}} <:party:${ID}> :P`)).toBe(
      `@{${ID}} 🙂 #{${ID}} <:party:${ID}> 😛`,
    );
  });

  it('nothing to do: as typed', () => {
    expect(convertEmoticons('')).toBe('');
    expect(convertEmoticons('plain words')).toBe('plain words');
  });
});
