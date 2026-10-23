/**
 * Text-to-speech messages (Discord's /tts, MESSAGE_FLAGS.TTS). One that arrives live in the
 * chat I'm looking at — open in a focused window, or its thread open beside the channel — is
 * read aloud with speechSynthesis as "<name> said <text>" while Settings ▸ Chats ▸ "Play /tts
 * messages" (`prefs.ttsPlayback`) is on. Utterances queue (speechSynthesis plays them in
 * order). Each message speaks once, and only live arrivals do (`speakArrivedMessage`, called
 * by the `message:new` handler): history pages, reloads and reconnects never replay one.
 * Messages of people I blocked or ignore stay silent.
 */
import { MESSAGE_FLAGS, hasMessageFlag, type ID, type Message } from '@enbox/shared';
import { plainMessageText } from '@/features/conversation/bubbles/cards/plainText';
import { isAppFocused } from '@/lib/notify';
import { registerSessionReset } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { isIgnored } from '@/stores/ignores';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { nameOf, useUsers } from '@/stores/users';

/** Message ids already spoken (or skipped as spoken), oldest first. */
const MAX_REMEMBERED = 500;
const spoken = new Set<ID>();

function remember(id: ID): void {
  spoken.add(id);
  if (spoken.size > MAX_REMEMBERED) spoken.delete(spoken.values().next().value!);
}

export function ttsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance === 'function'
  );
}

/** Stop speaking and drop the queue (the setting was turned off, sign-out). */
export function stopTts(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

registerSessionReset(() => {
  spoken.clear();
  stopTts();
});

/** Names as the chat shows them: a Space nickname first, my own display name for me. */
function namer(m: Message): (id: ID) => string {
  const spaceId = useChats.getState().byId[m.chatId]?.space?.spaceId;
  const members = spaceId ? useSpaces.getState().members[spaceId] : undefined;
  const you = useAuth.getState().user?.displayName;
  return (id) => members?.[id]?.nickname || nameOf(id, { you });
}

/** What is read for a TTS message: "<name> said <text>" (anonymous posts: the text), else null. */
export function ttsUtterance(m: Message): string | null {
  if (m.deletedAt || !m.text) return null;
  const names = namer(m);
  const text = plainMessageText(m.text, names);
  if (!text) return null;
  const chat = useChats.getState().byId[m.chatId];
  const who =
    m.authorOverride?.name ?? (m.senderId && chat?.type !== 'channel' ? names(m.senderId) : null);
  return who ? `${who} said ${text}` : text;
}

/** Whether `chatId` is on screen: the open chat, or the thread open beside its channel. */
function viewing(chatId: ID): boolean {
  if (!isAppFocused()) return false;
  if (useChats.getState().openChatId === chatId) return true;
  const panel = useSidePanel.getState().panel;
  return panel?.kind === 'thread' && panel.threadId === chatId;
}

/** A message that just arrived (`message:new`): read it aloud when it is a TTS one I'm viewing. */
export function speakArrivedMessage(m: Message): void {
  if (!hasMessageFlag(m.flags, MESSAGE_FLAGS.TTS) || spoken.has(m.id)) return;
  if (!useUi.getState().prefs.ttsPlayback || !ttsSupported() || !viewing(m.chatId)) return;
  if (m.senderId && (useUsers.getState().byId[m.senderId]?.isBlocked || isIgnored(m.senderId)))
    return;
  const text = ttsUtterance(m);
  if (!text) return;
  remember(m.id);
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
