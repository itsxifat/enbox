import { describe, expect, it } from 'vitest';

import { CHAT_THEME_PRESET_LABELS, CHAT_THEME_PRESETS } from './constants.js';
import type { ChatSummary, ChatTheme, MediaAttachment, Message, PresenceNote } from './models.js';
import {
  activePresenceNote,
  canEditMessage,
  effectiveAvailability,
  isDnd,
  isSharedChatTheme,
  messagePreviewText,
  renderMentions,
  systemEventText,
} from './utils.js';

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const past = '2026-09-26T11:59:59.999Z';
const future = '2026-09-26T12:00:00.001Z';

describe('effectiveAvailability', () => {
  it('returns the choice while it has no expiry', () => {
    expect(effectiveAvailability({ availability: 'dnd', availabilityUntil: null }, NOW)).toBe(
      'dnd',
    );
    expect(effectiveAvailability({ availability: 'invisible', availabilityUntil: null }, NOW)).toBe(
      'invisible',
    );
  });

  it('keeps the choice until the expiry passes, then reverts to online', () => {
    expect(effectiveAvailability({ availability: 'idle', availabilityUntil: future }, NOW)).toBe(
      'idle',
    );
    expect(effectiveAvailability({ availability: 'idle', availabilityUntil: past }, NOW)).toBe(
      'online',
    );
    // Exactly at the expiry the choice is over.
    expect(
      effectiveAvailability(
        { availability: 'dnd', availabilityUntil: new Date(NOW).toISOString() },
        NOW,
      ),
    ).toBe('online');
  });

  it('accepts a Date (database rows) as well as an ISO string', () => {
    expect(
      effectiveAvailability({ availability: 'dnd', availabilityUntil: new Date(future) }, NOW),
    ).toBe('dnd');
    expect(
      effectiveAvailability({ availability: 'dnd', availabilityUntil: new Date(past) }, NOW),
    ).toBe('online');
  });

  it('is online whatever a stale expiry says', () => {
    expect(effectiveAvailability({ availability: 'online', availabilityUntil: future }, NOW)).toBe(
      'online',
    );
  });
});

describe('isDnd', () => {
  it('is true only for an unexpired dnd choice', () => {
    expect(isDnd({ availability: 'dnd', availabilityUntil: null }, NOW)).toBe(true);
    expect(isDnd({ availability: 'dnd', availabilityUntil: future }, NOW)).toBe(true);
    expect(isDnd({ availability: 'dnd', availabilityUntil: past }, NOW)).toBe(false);
    expect(isDnd({ availability: 'idle', availabilityUntil: null }, NOW)).toBe(false);
    expect(isDnd({ availability: 'invisible', availabilityUntil: null }, NOW)).toBe(false);
  });
});

describe('activePresenceNote', () => {
  const note: PresenceNote = { text: 'Focus time', emoji: null, expiresAt: null };

  it('passes an unset note through as null', () => {
    expect(activePresenceNote(null, NOW)).toBeNull();
    expect(activePresenceNote(undefined, NOW)).toBeNull();
  });

  it('returns the note while it has not expired', () => {
    expect(activePresenceNote(note, NOW)).toBe(note);
    const timed = { ...note, expiresAt: future };
    expect(activePresenceNote(timed, NOW)).toBe(timed);
  });

  it('hides an expired note', () => {
    expect(activePresenceNote({ ...note, expiresAt: past }, NOW)).toBeNull();
    expect(activePresenceNote({ ...note, expiresAt: new Date(NOW).toISOString() }, NOW)).toBeNull();
  });
});

describe('systemEventText: theme_changed', () => {
  const nameOf = (id: string) => (id === 'me' ? 'You' : 'Alex');

  it('names the preset, or says the theme was removed', () => {
    expect(
      systemEventText({ kind: 'theme_changed', actorId: 'alex', preset: 'ocean' }, nameOf),
    ).toBe('Alex changed the chat theme to Ocean');
    expect(systemEventText({ kind: 'theme_changed', actorId: 'me', preset: null }, nameOf)).toBe(
      'You removed the chat theme',
    );
  });

  it('has a label for every preset, whatever the chat kind', () => {
    for (const preset of CHAT_THEME_PRESETS) {
      expect(
        systemEventText({ kind: 'theme_changed', actorId: 'alex', preset }, nameOf, 'channel'),
      ).toBe(`Alex changed the chat theme to ${CHAT_THEME_PRESET_LABELS[preset]}`);
    }
  });
});

describe('isSharedChatTheme', () => {
  const theme: ChatTheme = {
    preset: 'forest',
    bubbleStyle: null,
    accent: null,
    wallpaper: null,
    dim: 0,
    blur: 0,
    messageAnimation: null,
  };

  it('allows no wallpaper and built-in wallpapers', () => {
    expect(isSharedChatTheme(theme)).toBe(true);
    expect(isSharedChatTheme({ ...theme, wallpaper: { kind: 'preset', id: 'waves' } })).toBe(true);
  });

  it('refuses a theme showing my own wallpaper upload', () => {
    expect(isSharedChatTheme({ ...theme, wallpaper: { kind: 'media' } })).toBe(false);
  });
});

describe('renderMentions: custom emoji', () => {
  it('previews read :name: for custom emoji tokens', () => {
    const id = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    expect(renderMentions(`hi <:blob:${id}> <a:party:${id}> @{${id}}`, () => 'Maya')).toBe(
      'hi :blob: :party: @Maya',
    );
    expect(renderMentions('<:x:not-an-id>', () => '')).toBe('<:x:not-an-id>');
  });
});

describe('stickers and several files', () => {
  const file = (kind: MediaAttachment['kind'], id: string) =>
    ({ id, kind, url: `/uploads/${id}`, description: null }) as unknown as MediaAttachment & {
      description: string | null;
    };
  const base = {
    id: 'm1',
    chatId: 'c1',
    senderId: 'u1',
    type: 'image',
    text: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
  } as unknown as Message;

  it('previews a sticker by name, an album by count (or caption), mixed files as files', () => {
    expect(
      messagePreviewText({ ...base, sticker: { id: 's1', name: 'wave', spaceId: 'sp' } }),
    ).toBe('🖼️ Sticker: wave');
    const photos = [file('image', 'a'), file('image', 'b'), file('image', 'c')];
    expect(messagePreviewText({ ...base, attachments: photos })).toBe('📷 3 photos');
    expect(messagePreviewText({ ...base, attachments: photos, text: 'trip' })).toBe('📷 trip');
    expect(
      messagePreviewText({ ...base, attachments: [file('image', 'a'), file('file', 'd')] }),
    ).toBe('📎 2 files');
    // One file keeps the old wording.
    expect(messagePreviewText({ ...base, attachments: [file('image', 'a')] })).toBe('📷 Photo');
  });

  it('never offers editing a sticker message', () => {
    const chat = { type: 'direct', permissions: { canSend: true } } as unknown as Pick<
      ChatSummary,
      'type' | 'permissions'
    >;
    expect(canEditMessage(base, chat, 'u1')).toBe(true);
    expect(
      canEditMessage({ ...base, sticker: { id: 's1', name: 'wave', spaceId: 'sp' } }, chat, 'u1'),
    ).toBe(false);
  });
});
