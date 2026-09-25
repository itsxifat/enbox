import { describe, expect, it } from 'vitest';
import { extractLinks, hostOf, hrefOf, linkify } from './links';

describe('links', () => {
  it('extracts http(s) and www links, trimming punctuation', () => {
    expect(
      extractLinks('See https://enbox.app/docs, and www.example.com/path. Also (https://x.io)!'),
    ).toEqual(['https://enbox.app/docs', 'www.example.com/path', 'https://x.io']);
  });

  it('keeps balanced parentheses and de-duplicates', () => {
    expect(
      extractLinks(
        'https://en.wikipedia.org/wiki/Foo_(bar) and https://en.wikipedia.org/wiki/Foo_(bar)',
      ),
    ).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    expect(extractLinks(null)).toEqual([]);
    expect(extractLinks('no links here')).toEqual([]);
  });

  it('builds safe hrefs and hosts', () => {
    expect(hrefOf('www.example.com')).toBe('https://www.example.com/');
    expect(hrefOf('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
    expect(hrefOf('javascript:alert(1)')).toBeNull();
    expect(hostOf('https://www.enbox.app/x')).toBe('enbox.app');
  });

  it('splits text into parts', () => {
    expect(linkify('Visit https://enbox.app now')).toEqual([
      { type: 'text', text: 'Visit ' },
      { type: 'link', text: 'https://enbox.app', href: 'https://enbox.app/' },
      { type: 'text', text: ' now' },
    ]);
    expect(linkify('plain')).toEqual([{ type: 'text', text: 'plain' }]);
  });
});
