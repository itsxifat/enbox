import { describe, expect, it } from 'vitest';
import {
  emojiOnlyCount,
  firstUrl,
  inlineToPlain,
  linkify,
  parseRichText,
  splitHighlight,
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

describe('parseRichText', () => {
  it('parses mentions, formatting and links together', () => {
    const segs = parseRichText(`Hi @{${U}}, *bold* _it_ ~gone~ and \`\`\`code\`\`\` https://x.io`);
    expect(segs[0]).toEqual({ t: 'text', text: 'Hi ' });
    expect(segs[1]).toEqual({ t: 'mention', userId: U });
    expect(segs.some((s) => s.t === 'bold')).toBe(true);
    expect(segs.some((s) => s.t === 'italic')).toBe(true);
    expect(segs.some((s) => s.t === 'strike')).toBe(true);
    expect(segs.some((s) => s.t === 'code')).toBe(true);
    expect(segs.some((s) => s.t === 'link')).toBe(true);
    expect(inlineToPlain(segs, name)).toBe('Hi @Maya, bold it gone and code https://x.io');
  });

  it('does not format inside words or across lines', () => {
    expect(parseRichText('snake_case_name and 2*3*4')).toEqual([
      { t: 'text', text: 'snake_case_name and 2*3*4' },
    ]);
    expect(parseRichText('*not\nbold*')).toEqual([{ t: 'text', text: '*not\nbold*' }]);
  });

  it('supports nested formatting', () => {
    const [seg] = parseRichText('*very _nice_*');
    expect(seg).toMatchObject({ t: 'bold' });
    expect(inlineToPlain([seg!], name)).toBe('very nice');
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
