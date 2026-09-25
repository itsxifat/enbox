import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionState } from '@/lib/session';
import { mergeWatermarks } from '@/realtime/chats';
import { useAuth } from '@/stores/auth';
import { selectSortedChats } from '@/stores/chats';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { flushDrafts, getDraft, useDrafts } from './drafts';
import { messageLink } from './links';
import { previewParts } from './preview';
import { snippetAround } from './MessageSearchResults';

describe('drafts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuth.setState({ user: makeMe({ id: 'u-1' }) });
  });
  afterEach(() => {
    resetSessionState();
    vi.useRealTimers();
  });

  it('stores drafts per chat and persists them per account', () => {
    useDrafts.getState().setDraft('c1', 'hello', 'm-9');
    expect(getDraft('c1')).toMatchObject({ text: 'hello', replyToId: 'm-9' });
    vi.advanceTimersByTime(500);
    expect(JSON.parse(localStorage.getItem('enbox.drafts.u-1')!).c1.text).toBe('hello');

    // Empty text without a reply clears it.
    useDrafts.getState().setDraft('c1', '   ');
    flushDrafts();
    expect(getDraft('c1')).toBeUndefined();
    expect(localStorage.getItem('enbox.drafts.u-1')).toBeNull();
  });

  it('forgets drafts on logout', () => {
    useDrafts.getState().setDraft('c2', 'secret');
    flushDrafts();
    resetSessionState();
    expect(useDrafts.getState().byChat).toEqual({});
    expect(localStorage.getItem('enbox.drafts.u-1')).toBeNull();
  });
});

describe('mergeWatermarks (chat:watermarks)', () => {
  it('never moves ticks backwards', () => {
    const chat = { type: 'group' as const, readWatermark: 10, deliveredWatermark: 12 };
    expect(mergeWatermarks(chat, { readWatermark: 8, deliveredWatermark: 15 })).toEqual({
      readWatermark: 10,
      deliveredWatermark: 15,
    });
  });
  it('accepts read receipts being turned off in direct chats (0)', () => {
    const chat = { type: 'direct' as const, readWatermark: 10, deliveredWatermark: 12 };
    expect(mergeWatermarks(chat, { readWatermark: 0, deliveredWatermark: 12 })).toEqual({
      readWatermark: 0,
      deliveredWatermark: 12,
    });
  });
});

describe('chat list helpers', () => {
  it('filters favorites (pinned chats)', () => {
    const chats = [makeChat({ id: 'a', isPinned: true }), makeChat({ id: 'b' })];
    const byId = Object.fromEntries(chats.map((c) => [c.id, c]));
    expect(selectSortedChats(byId, { filter: 'favorites' }).map((c) => c.id)).toEqual(['a']);
  });

  it('builds message links', () => {
    expect(messageLink('c1', 42, 'm1')).toBe('/chats/c1?m=42&mid=m1');
    expect(messageLink('c1', 7, undefined, '/starred')).toBe('/starred/c1?m=7');
  });

  it('keeps search matches visible in snippets', () => {
    expect(snippetAround('short text', 'text')).toBe('short text');
    const long = 'lorem ipsum dolor sit amet consectetur adipiscing elit the aquarium room';
    expect(snippetAround(long, 'aquarium').startsWith('…')).toBe(true);
    expect(snippetAround(long, 'aquarium')).toContain('aquarium room');
  });

  it('previews: icons replace emoji, voice shows duration, missed calls are red', () => {
    const voice = previewParts(
      makeMessage({ type: 'voice', text: null, media: { durationMs: 14_000 } as never }),
    );
    expect(voice.text).toBe('0:14');
    expect(voice.icon).not.toBeNull();

    const photo = previewParts(makeMessage({ type: 'image', text: 'Sunset', media: {} as never }));
    expect(photo.text).toBe('Sunset');

    const missed = previewParts(
      makeMessage({
        type: 'call',
        senderId: 'bob',
        text: null,
        call: {
          callId: 'x',
          callType: 'audio',
          isGroup: false,
          initiatorId: 'bob',
          status: 'missed',
          durationSec: null,
        },
      }),
      { meId: 'me' },
    );
    expect(missed).toMatchObject({ text: 'Missed voice call', danger: true });

    const deleted = previewParts(
      makeMessage({ deletedAt: '2025-01-01T00:00:00.000Z', senderId: 'me' }),
      {
        meId: 'me',
      },
    );
    expect(deleted).toMatchObject({ text: 'You deleted this message', italic: true });
  });
});
