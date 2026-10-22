import { describe, expect, it } from 'vitest';
import {
  emojiOnlyCount,
  firstUrl,
  formatTimestamp,
  inlineToPlain,
  linkify,
  parseMarkdown,
  parseRichText,
  plainCustomEmoji,
  splitHighlight,
  type Block,
} from './richText';

const U = '0f8f5c1e-2a4b-4c6d-8e9f-0123456789ab';
const name = () => 'Maya';

describe('linkify', () => {
  it('finds http(s), www and e-mail links and strips trailing punctuation', () => {
    const segs = linkify('See https://enbox.app/docs?x=1, or www.example.com. Mail me@site.io!');
    const links = segs.filter((s) => s.t === 'link');
    expect(links).toEqual([
      { t: 'link', text: 'https://enbox.app/docs?x=1', href: 'https://enbox.app/docs?x=1' },
      { t: 'link', text: 'www.example.com', href: 'https://www.example.com' },
      { t: 'link', text: 'me@site.io', href: 'mailto:me@site.io' },
    ]);
    expect(segs.map((s) => ('text' in s ? s.text : '')).join('')).toBe(
      'See https://enbox.app/docs?x=1, or www.example.com. Mail me@site.io!',
    );
  });

  it('leaves plain text alone', () => {
    expect(linkify('no links here')).toEqual([{ t: 'text', text: 'no links here' }]);
  });
});

describe('parseRichText (Discord inline markdown)', () => {
  it('parses mentions, formatting and links together', () => {
    const segs = parseRichText(
      `Hi @{${U}}, **bold** *it* __under__ ~~gone~~ ||secret|| and \`code\` https://x.io`,
    );
    expect(segs[0]).toEqual({ t: 'text', text: 'Hi ' });
    expect(segs[1]).toEqual({ t: 'mention', userId: U });
    for (const t of ['bold', 'italic', 'underline', 'strike', 'spoiler', 'code', 'link'])
      expect(segs.some((s) => s.t === t)).toBe(true);
    expect(inlineToPlain(segs, name)).toBe(
      'Hi @Maya, bold it under gone secret and code https://x.io',
    );
  });

  it('keeps mentions inside formatting', () => {
    const [seg] = parseRichText(`**hey @{${U}}**`);
    expect(seg).toMatchObject({ t: 'bold', children: [{ t: 'text', text: 'hey ' }, { t: 'mention', userId: U }] });
  });

  it('leaves snake_case, escapes and URLs alone; * italics need no word boundary', () => {
    expect(parseRichText('snake_case_name and 2 * 3')).toEqual([
      { t: 'text', text: 'snake_case_name and 2 * 3' },
    ]);
    // Discord renders 2*3*4 with an italic 3.
    expect(parseRichText('2*3*4')[1]).toMatchObject({ t: 'italic' });
    expect(parseRichText('\\*\\*not bold\\*\\*')).toEqual([{ t: 'text', text: '**not bold**' }]);
    expect(parseRichText('see https://x.io/a__b__c')).toEqual([
      { t: 'text', text: 'see ' },
      { t: 'link', text: 'https://x.io/a__b__c', href: 'https://x.io/a__b__c' },
    ]);
  });

  it('supports nesting, masked links and timestamps', () => {
    const [bi] = parseRichText('***both***');
    expect(bi).toMatchObject({ t: 'bold', children: [{ t: 'italic' }] });
    expect(parseRichText('[docs](https://enbox.app/d)')).toEqual([
      { t: 'link', text: 'docs', href: 'https://enbox.app/d', children: [{ t: 'text', text: 'docs' }] },
    ]);
    expect(parseRichText('[x](javascript:alert(1))')[0]).toMatchObject({ t: 'text' });
    expect(parseRichText('<t:1700000000:R>')).toEqual([{ t: 'timestamp', unix: 1700000000, style: 'R' }]);
    expect(parseRichText('`**raw**`')).toEqual([{ t: 'code', children: [{ t: 'text', text: '**raw**' }] }]);
  });
});

describe('parseMarkdown (blocks)', () => {
  it('reads headers, subtext, quotes, lists and code blocks', () => {
    const blocks = parseMarkdown(
      '# Title\n-# small print\n> quoted\n> more\n- one\n- two\n  - nested\n1. first\n```js\nconst a = 1;\n```\nafter',
    );
    expect(blocks.map((b) => b.b)).toEqual(['h', 'sub', 'quote', 'list', 'list', 'code', 'p']);
    expect(blocks[0]).toMatchObject({ b: 'h', level: 1 });
    expect(blocks[3]).toMatchObject({ b: 'list', ordered: false });
    expect((blocks[3] as Extract<Block, { b: 'list' }>).items[1]!.map((b) => b.b)).toEqual(['p', 'list']);
    expect(blocks[4]).toMatchObject({ b: 'list', ordered: true, start: 1 });
    expect(blocks[5]).toEqual({ b: 'code', lang: 'js', code: 'const a = 1;' });
  });

  it('quotes the rest of the message after >>>, and keeps plain lines as one paragraph', () => {
    expect(parseMarkdown('>>> a\nb')).toEqual([
      { b: 'quote', children: [{ b: 'p', children: [{ t: 'text', text: 'a\nb' }] }] },
    ]);
    expect(parseMarkdown('line one\nline two')).toEqual([
      { b: 'p', children: [{ t: 'text', text: 'line one\nline two' }] },
    ]);
    expect(parseMarkdown('#nospace')[0]).toMatchObject({ b: 'p' });
  });

  it('formats Discord timestamps', () => {
    const now = 1_700_000_000_000;
    expect(formatTimestamp(1_700_000_000 - 120, 'R', now)).toMatch(/2 minutes ago/);
    expect(formatTimestamp(1_700_000_000 + 86_400 * 3, 'R', now)).toMatch(/3 days|in 3 days/);
  });
});

describe('emojiOnlyCount', () => {
  it('counts 1–3 emoji (incl. ZWJ, flags, skin tones)', () => {
    expect(emojiOnlyCount('😂')).toBe(1);
    expect(emojiOnlyCount('👍🏽 ❤️')).toBe(2);
    expect(emojiOnlyCount('👨‍👩‍👧🇫🇷🎉')).toBe(3);
  });
  it('rejects text, digits and more than 3 emoji', () => {
    expect(emojiOnlyCount('ok 👍')).toBe(0);
    expect(emojiOnlyCount('123')).toBe(0);
    expect(emojiOnlyCount('😂😂😂😂')).toBe(0);
    expect(emojiOnlyCount('')).toBe(0);
    expect(emojiOnlyCount(null)).toBe(0);
  });
});

describe('custom emoji tokens', () => {
  const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const ID2 = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
  const blob = `<:blob:${ID}>`;
  const party = `<a:party_2:${ID2}>`;

  it('parses static and animated tokens inside text and formatting', () => {
    expect(parseRichText(`hi ${blob}!`)).toEqual([
      { t: 'text', text: 'hi ' },
      { t: 'emoji', id: ID, name: 'blob', animated: false },
      { t: 'text', text: '!' },
    ]);
    expect(parseRichText(`**${party}**`)).toEqual([
      { t: 'bold', children: [{ t: 'emoji', id: ID2, name: 'party_2', animated: true }] },
    ]);
    // Next to a mention and right after a link.
    const segs = parseRichText(`@{${U}} ${blob} https://x.io${blob}`);
    expect(segs.map((s) => s.t)).toEqual(['mention', 'text', 'emoji', 'text', 'link', 'emoji']);
    expect(segs[4]).toMatchObject({ t: 'link', href: 'https://x.io' });
    expect(inlineToPlain(segs, name)).toBe('@Maya :blob: https://x.io:blob:');
  });

  it('shows tokens raw in code spans and code blocks', () => {
    expect(parseRichText(`\`${blob}\``)).toEqual([{ t: 'code', children: [{ t: 'text', text: blob }] }]);
    expect(parseMarkdown(`\`\`\`\n${party}\n\`\`\``)).toEqual([{ b: 'code', lang: null, code: party }]);
  });

  it('an escaped token is its raw text', () => {
    expect(parseRichText(`\\${blob}`)).toEqual([{ t: 'text', text: blob }]);
    // An escaped backslash does not escape the token.
    expect(parseRichText(`\\\\${blob}`)).toEqual([
      { t: 'text', text: '\\' },
      { t: 'emoji', id: ID, name: 'blob', animated: false },
    ]);
  });

  it('ignores malformed tokens', () => {
    for (const text of ['<:b:' + ID + '>', `<:blob:${ID.toUpperCase()}>`, '<:blob:123>', `<x:blob:${ID}>`])
      expect(parseRichText(text).some((s) => s.t === 'emoji')).toBe(false);
  });

  it('counts custom emoji for jumbo messages', () => {
    expect(emojiOnlyCount(blob)).toBe(1);
    expect(emojiOnlyCount(`${blob} ${party}`)).toBe(2);
    expect(emojiOnlyCount(`${blob}😂 ${party}`)).toBe(3);
    expect(emojiOnlyCount(`${blob}${blob}${blob}${blob}`)).toBe(0);
    expect(emojiOnlyCount(`${blob}😂😂😂`)).toBe(0);
    expect(emojiOnlyCount(`ok ${blob}`)).toBe(0);
    expect(emojiOnlyCount(`\\${blob}`)).toBe(0);
  });

  it('plainCustomEmoji turns tokens into :name:', () => {
    expect(plainCustomEmoji(`hi ${blob} ${party}`)).toBe('hi :blob: :party_2:');
    expect(plainCustomEmoji('no tokens')).toBe('no tokens');
  });
});

describe('splitHighlight / firstUrl', () => {
  it('splits case-insensitively, alternating plain/match', () => {
    expect(splitHighlight('Pelican and pelicans', 'PELICAN')).toEqual([
      '',
      'Pelican',
      ' and ',
      'pelican',
      's',
    ]);
    expect(splitHighlight('abc', '')).toEqual(['abc']);
  });
  it('returns the first web link', () => {
    expect(firstUrl('mail a@b.co then https://enbox.app')).toBe('https://enbox.app');
    expect(firstUrl('nothing')).toBeNull();
  });
});
