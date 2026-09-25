import { describe, expect, it } from 'vitest';
import { safeNext } from './guards';

describe('safeNext', () => {
  it('keeps same-app paths (normalized, with query and hash)', () => {
    expect(safeNext('/chats/abc')).toBe('/chats/abc');
    expect(safeNext('/calls/x?tab=missed#top')).toBe('/calls/x?tab=missed#top');
    expect(safeNext('/updates/../chats')).toBe('/chats');
  });

  it('falls back for missing, relative and protocol-relative values', () => {
    expect(safeNext(null)).toBe('/chats');
    expect(safeNext('')).toBe('/chats');
    expect(safeNext('chats')).toBe('/chats');
    expect(safeNext('https://evil.example/x')).toBe('/chats');
    expect(safeNext('//evil.example')).toBe('/chats');
    expect(safeNext('/\\evil.example')).toBe('/chats');
  });

  it('rejects control characters the URL parser would strip (/<TAB>/host)', () => {
    const tab = new URLSearchParams('next=%2F%09%2Fevil.example').get('next');
    expect(tab).toBe('/\t/evil.example');
    // What the browser would make of it without the check:
    expect(new URL(tab!, 'https://app.example').origin).toBe('https://evil.example');
    expect(safeNext(tab)).toBe('/chats');
    expect(safeNext('/\n/evil.example')).toBe('/chats');
    expect(safeNext('/\r/evil.example', '')).toBe('');
  });

  it('never redirects back to the auth pages', () => {
    expect(safeNext('/login')).toBe('/chats');
    expect(safeNext('/register?x=1')).toBe('/chats');
    expect(safeNext('/login/')).toBe('/chats');
    expect(safeNext('/loginhelp')).toBe('/loginhelp');
  });
});
