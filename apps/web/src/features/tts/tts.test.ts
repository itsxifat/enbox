/**
 * Text-to-speech playback on arrival (`message:new` → realtime/messages.ts): a TTS message in
 * the chat I'm viewing is read aloud as "<name> said <text>" — queued, once — with the setting
 * on; nothing for messages without the flag, other chats, an unfocused window, the setting
 * off, people I blocked, or history pages and reloads (upserts that are no arrival).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_FLAGS, type Message } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { handleNewMessage } from '@/realtime/messages';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { speakArrivedMessage, ttsUtterance } from './tts';

let speak: ReturnType<typeof vi.fn>;
let n = 0;
const OLIVE = '00000000-0000-4000-8000-00000000aaaa';
const BRAM = '00000000-0000-4000-8000-00000000bbbb';
const group = makeChat({ id: 'g1', type: 'group', name: 'Friends', lastSeq: 100 });
const other = makeChat({ id: 'g2', type: 'group', name: 'Others', lastSeq: 100 });

function tts(p: Partial<Message> = {}): Message {
  n += 1;
  return makeMessage({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    chatId: 'g1',
    seq: 100 + n,
    senderId: OLIVE,
    text: 'hello **everyone**',
    flags: MESSAGE_FLAGS.TTS,
    createdAt: new Date().toISOString(),
    ...p,
  });
}

const spokenTexts = () => speak.mock.calls.map((c) => (c[0] as { text: string }).text);

beforeEach(() => {
  speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
  vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Me' }),
    token: 't',
    status: 'authenticated',
  });
  useUi.setState({ prefs: { ...DEFAULT_PREFS } });
  useUsers.setState({
    byId: {
      [OLIVE]: makeUser({ id: OLIVE, displayName: 'Olive' }),
      [BRAM]: makeUser({ id: BRAM, displayName: 'Bram', isBlocked: true }),
    },
  });
  useChats.setState({ byId: { g1: group, g2: other }, openChatId: 'g1' });
});

afterEach(() => {
  resetSessionState();
  useChats.setState({ byId: {}, openChatId: null });
  useMessages.setState({ byChat: {} });
  useSidePanel.setState({ panel: null });
});

describe('text-to-speech', () => {
  it('a TTS message arriving in the chat I am viewing is read aloud, once', () => {
    const m = tts();
    handleNewMessage(m);
    expect(spokenTexts()).toEqual(['Olive said hello everyone']);
    // The echo or a re-delivery of the same message stays quiet.
    handleNewMessage(m);
    speakArrivedMessage(m);
    expect(speak).toHaveBeenCalledTimes(1);
    // Several in a row queue up in order.
    handleNewMessage(tts({ text: 'one' }));
    handleNewMessage(tts({ text: 'two', senderId: 'me' }));
    expect(spokenTexts()).toEqual(['Olive said hello everyone', 'Olive said one', 'Me said two']);
  });

  it('nothing without the flag, in other chats, unfocused, or with the setting off', () => {
    handleNewMessage(tts({ flags: undefined }));
    handleNewMessage(tts({ chatId: 'g2' }));
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    handleNewMessage(tts());
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    useUi.getState().setPref('ttsPlayback', false);
    handleNewMessage(tts());
    expect(speak).not.toHaveBeenCalled();
    useUi.getState().setPref('ttsPlayback', true);
    handleNewMessage(tts({ text: 'now' }));
    expect(spokenTexts()).toEqual(['Olive said now']);
  });

  it('a thread open beside its channel counts as viewed; blocked people stay silent', () => {
    useSidePanel.setState({ panel: { kind: 'thread', threadId: 'g2', parentId: 'c1' } });
    handleNewMessage(tts({ chatId: 'g2', text: 'in the thread' }));
    handleNewMessage(tts({ senderId: BRAM, text: 'from bram' }));
    expect(spokenTexts()).toEqual(['Olive said in the thread']);
  });

  it('history pages and reloads never speak', () => {
    const page = [tts(), tts()];
    useMessages.setState({
      byChat: {
        g1: { items: page, loaded: true, hasMoreBefore: false, hasMoreAfter: false } as never,
      },
    });
    for (const m of page) useMessages.getState().upsertMessage(m);
    expect(speak).not.toHaveBeenCalled();
  });

  it('reads plain words: mentions by name, no formatting, spoilers left out', () => {
    expect(
      ttsUtterance(
        tts({
          text: `hey @{${OLIVE}}, ~~old~~ *new* ||secret|| <:blob:00000000-0000-4000-8000-000000000001>`,
        }),
      ),
    ).toBe('Olive said hey @Olive, old new spoiler :blob:');
    expect(ttsUtterance(tts({ text: null }))).toBeNull();
    expect(ttsUtterance(tts({ deletedAt: new Date().toISOString() }))).toBeNull();
    // Webhooks speak as their name.
    expect(
      ttsUtterance(
        tts({
          senderId: null,
          text: 'deploy done',
          authorOverride: { kind: 'webhook', name: 'CI Bot', avatarUrl: null, webhookId: null },
        }),
      ),
    ).toBe('CI Bot said deploy done');
  });
});
