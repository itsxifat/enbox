import { describe, expect, it } from 'vitest';
import {
  canLink,
  isQuoted,
  isWrapped,
  makeLink,
  normalizeLinkUrl,
  toggleInline,
  toggleQuote,
  type InlineFormat,
  type TextEdit,
} from './markdown';
import { shortcutFormat } from './shortcuts';

/** The edit applied: the new text with the selection marked as [ ]. */
function apply(value: string, edit: TextEdit): string {
  const next = value.slice(0, edit.start) + edit.insert + value.slice(edit.end);
  return `${next.slice(0, edit.selStart)}[${next.slice(edit.selStart, edit.selEnd)}]${next.slice(edit.selEnd)}`;
}

/** Toggle `format` on the [selected] part of `marked` ("a [b] c"; "a [] c" is a caret). */
function toggle(marked: string, format: InlineFormat): string {
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  const value = marked.replace('[', '').replace(']', '');
  return apply(value, toggleInline(value, start, end, format));
}

describe('toggleInline', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(toggle('hello [world]', 'bold')).toBe('hello **[world]**');
    expect(toggle('hello [world]', 'italic')).toBe('hello *[world]*');
    expect(toggle('hello [world]', 'underline')).toBe('hello __[world]__');
    expect(toggle('hello [world]', 'strike')).toBe('hello ~~[world]~~');
    expect(toggle('hello [world]', 'spoiler')).toBe('hello ||[world]||');
    expect(toggle('hello [world]', 'code')).toBe('hello `[world]`');
  });

  it('unwraps a selection that wears the format, with or without its markers', () => {
    expect(toggle('hello **[world]**', 'bold')).toBe('hello [world]');
    expect(toggle('hello [**world**]', 'bold')).toBe('hello [world]');
    expect(toggle('a ~~[b]~~ c', 'strike')).toBe('a [b] c');
    expect(toggle('a [`b`] c', 'code')).toBe('a [b] c');
  });

  it('tells italic and bold apart in runs of *', () => {
    // Italic inside bold, and back.
    expect(toggle('**[x]**', 'italic')).toBe('***[x]***');
    expect(toggle('***[x]***', 'italic')).toBe('**[x]**');
    expect(toggle('***[x]***', 'bold')).toBe('*[x]*');
    expect(toggle('*[x]*', 'bold')).toBe('***[x]***');
  });

  it('keeps whitespace at the edges outside the markers', () => {
    expect(toggle('say[ hi ]now', 'bold')).toBe('say **[hi]** now');
  });

  it('puts an empty pair around the caret, and takes an empty pair away', () => {
    expect(toggle('hi []', 'bold')).toBe('hi **[]**');
    expect(toggle('hi **[]**', 'bold')).toBe('hi []');
    expect(toggle('a *[]* b', 'italic')).toBe('a [] b');
    expect(toggle('a[]b', 'strike')).toBe('a~~[]~~b');
  });

  it('reports what the selection wears', () => {
    expect(isWrapped('**hi**', 2, 4, 'bold')).toBe(true);
    expect(isWrapped('**hi**', 0, 6, 'bold')).toBe(true);
    expect(isWrapped('**hi**', 2, 4, 'italic')).toBe(false);
    expect(isWrapped('hi', 0, 2, 'bold')).toBe(false);
    expect(isWrapped('**hi**', 3, 3, 'bold')).toBe(false);
  });
});

describe('toggleQuote', () => {
  it('quotes every line the selection touches, then takes the quotes away', () => {
    const value = 'one\ntwo\nthree';
    const quoted = toggleQuote(value, 1, 5); // "ne\nt"
    expect(apply(value, quoted)).toBe('[> one\n> two]\nthree');
    const back = value.replace('one\ntwo', '> one\n> two');
    expect(isQuoted(back, 0, 7)).toBe(true);
    expect(apply(back, toggleQuote(back, 0, 7))).toBe('[one\ntwo]\nthree');
  });

  it('quotes the caret’s line; a selection ending at a line break leaves the next line', () => {
    expect(apply('a\nb', toggleQuote('a\nb', 3, 3))).toBe('a\n[> b]');
    expect(apply('a\nb', toggleQuote('a\nb', 0, 2))).toBe('[> a]\nb');
    expect(isQuoted('> a\nb', 0, 5)).toBe(false);
  });
});

describe('links', () => {
  it('makes a masked link of the selection, the caret after it', () => {
    expect(apply('see docs now', makeLink('see docs now', 4, 8, 'https://enbox.app/'))).toBe(
      'see [docs](https://enbox.app/)[] now',
    );
  });

  it('accepts web addresses only, adding https:// to bare ones', () => {
    expect(normalizeLinkUrl('enbox.app/help')).toBe('https://enbox.app/help');
    expect(normalizeLinkUrl(' https://x.io/a?b=1 ')).toBe('https://x.io/a?b=1');
    expect(normalizeLinkUrl('http://localhost:5173/x')).toBe('http://localhost:5173/x');
    // Parentheses would end the link early: encoded.
    expect(normalizeLinkUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
      'https://en.wikipedia.org/wiki/Foo_%28bar%29',
    );
    for (const bad of ['', 'hello', 'not a link', 'javascript:alert(1)', 'ftp://files.example.com'])
      expect(normalizeLinkUrl(bad)).toBeNull();
  });

  it('links one line of text without ]', () => {
    expect(canLink('a docs b', 2, 6)).toBe(true);
    expect(canLink('a\nb', 0, 3)).toBe(false);
    expect(canLink('[x] y', 0, 3)).toBe(false);
    expect(canLink('abc', 1, 1)).toBe(false);
  });
});

describe('shortcutFormat', () => {
  const key = (
    k: string,
    mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>>,
    code = `Key${k.toUpperCase()}`,
  ) => ({
    key: k,
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it('maps Ctrl+B / I / U and Ctrl+Shift+X (Cmd on a Mac)', () => {
    expect(shortcutFormat(key('b', { ctrlKey: true }), false)).toBe('bold');
    expect(shortcutFormat(key('i', { ctrlKey: true }), false)).toBe('italic');
    expect(shortcutFormat(key('u', { ctrlKey: true }), false)).toBe('underline');
    expect(shortcutFormat(key('X', { ctrlKey: true, shiftKey: true }), false)).toBe('strike');
    expect(shortcutFormat(key('b', { metaKey: true }), true)).toBe('bold');
    expect(shortcutFormat(key('b', { ctrlKey: true }), true)).toBeNull();
  });

  it('ignores other keys and modifiers; letters by position on other layouts', () => {
    expect(shortcutFormat(key('b', {}), false)).toBeNull();
    expect(shortcutFormat(key('b', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(shortcutFormat(key('b', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(shortcutFormat(key('k', { ctrlKey: true }), false)).toBeNull();
    expect(shortcutFormat(key('и', { ctrlKey: true }, 'KeyB'), false)).toBe('bold');
  });
});
