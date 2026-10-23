/**
 * Message actions of the Discord menus beyond the basics in actions.ts: Mark Unread (and the
 * NEW line it moves, here and on my other devices), Copy Message Link, Copy ID (Developer
 * Mode), Discord's Delete Message (one confirmation, none with Shift) and Speak Message.
 * Used by the hover toolbar (MessageRow `RowToolbar`) and the menus (MessageActionsHost).
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import {
  canDeleteForEveryone,
  isSpaceChatType,
  type ChatReadState,
  type ChatSummary,
  type ID,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { isLocalId } from '@/lib/ids';
import { registerSessionReset } from '@/lib/session';
import { getMyId } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { confirm, toast, useUi } from '@/stores/ui';
import { nameOf } from '@/stores/users';
import { chatPath } from '@/features/chats/links';
import { copyText as copyToClipboard } from '@/features/groups/shared/share';
import { copyText, deleteMessages, isActionable } from './actions';

// ---------------------------------------------------------------------------
// Mark Unread and the NEW line
// ---------------------------------------------------------------------------

/** Where Mark Unread put the NEW line: after `afterSeq`, `count` unread messages. */
export interface UnreadMark {
  afterSeq: number;
  count: number;
}

interface UnreadMarksState {
  marks: Record<ID, UnreadMark | undefined>;
  set(chatId: ID, mark: UnreadMark): void;
  /** The conversation took it (it shows the divider from then on). */
  take(chatId: ID): void;
}

/** NEW lines waiting for their open conversation (ConversationPane shows them). */
export const useUnreadMarks = create<UnreadMarksState>((set, get) => ({
  marks: {},
  set: (chatId, mark) => set((s) => ({ marks: { ...s.marks, [chatId]: mark } })),
  take: (chatId) => {
    if (get().marks[chatId]) set((s) => ({ marks: { ...s.marks, [chatId]: undefined } }));
  },
}));

registerSessionReset(() => useUnreadMarks.setState({ marks: {} }));

function showReadState(s: ChatReadState): void {
  useChats.getState().patchChat(s.chatId, {
    lastReadSeq: s.lastReadSeq,
    unreadCount: s.unreadCount,
    unreadMentionCount: s.unreadMentionCount,
    markedUnread: s.markedUnread,
  });
  useUnreadMarks
    .getState()
    .set(s.chatId, { afterSeq: s.lastReadSeq, count: Math.max(1, s.unreadCount) });
}

/** Mark Unread: my read position goes to just before `m` (the server syncs my devices). */
export function canMarkUnread(chat: ChatSummary, m: ClientMessage): boolean {
  return isActionable(m) && m.seq > 0 && chat.membership === 'active';
}

export async function markUnread(chat: ChatSummary, m: ClientMessage): Promise<void> {
  if (!canMarkUnread(chat, m)) return;
  try {
    showReadState(
      await api.post<ChatReadState>(`/api/chats/${chat.id}/unread`, { messageId: m.id }),
    );
  } catch (e) {
    toast.error(e);
  }
}

/**
 * Another device marked this open chat unread: its summary came back with an earlier read
 * position and `markedUnread` (reads only move it forward and clear the flag), so the NEW line
 * moves there too.
 */
export function useUnreadMarkSync(chat: ChatSummary): void {
  const last = useRef(chat.lastReadSeq);
  useEffect(() => {
    const before = last.current;
    last.current = chat.lastReadSeq;
    if (chat.markedUnread && chat.lastReadSeq < before)
      useUnreadMarks
        .getState()
        .set(chat.id, { afterSeq: chat.lastReadSeq, count: Math.max(1, chat.unreadCount) });
  }, [chat.id, chat.lastReadSeq, chat.markedUnread, chat.unreadCount]);
}

// ---------------------------------------------------------------------------
// Links and ids
// ---------------------------------------------------------------------------

/** `https://…/spaces/<space>/<channel>?m=<seq>&mid=<id>` (or the chat's own path). */
export function messageUrl(chat: ChatSummary, m: Pick<ClientMessage, 'id' | 'seq'>): string {
  return `${location.origin}${chatPath(chat, { seq: m.seq, messageId: m.id })}`;
}

async function copyWithToast(text: string, done: string): Promise<void> {
  if (await copyToClipboard(text)) toast.success(done, { id: 'copied' });
  else toast.error("Couldn't copy to the clipboard");
}

export function copyMessageLink(chat: ChatSummary, m: ClientMessage): Promise<void> {
  return copyWithToast(messageUrl(chat, m), 'Link copied');
}

/** Developer Mode's Copy ID (messages here; users, channels and Spaces in their menus). */
export function copyId(id: ID, what = 'ID'): Promise<void> {
  return copyWithToast(id, `${what} copied`);
}

export function useDeveloperMode(): boolean {
  return useUi((s) => s.prefs.developerMode);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Whether Delete Message shows. Space channels (Discord): only what I may delete for
 * everyone (mine, or anyone's with MANAGE_MESSAGES). Other chats: always (for me at least).
 */
export function canDeleteMessage(chat: ChatSummary, m: ClientMessage): boolean {
  if (!isSpaceChatType(chat.type) || !isActionable(m)) return true;
  const me = getMyId();
  return !!me && canDeleteForEveryone(m, chat, me);
}

async function removeNow(chat: ChatSummary, m: ClientMessage, mode: 'me' | 'everyone') {
  const store = useMessages.getState();
  if (mode === 'me') store.removeMessages(chat.id, [m.id]);
  else
    store.patchMessage(chat.id, m.id, {
      deletedAt: new Date().toISOString(),
      text: null,
      media: null,
      reactions: [],
      poll: null,
      location: null,
      contact: null,
    });
  try {
    await api.delete(`/api/messages/${m.id}`, undefined, { query: { for: mode } });
    if (mode === 'me' && useChats.getState().byId[chat.id]?.lastMessage?.id === m.id)
      void useChats
        .getState()
        .refreshChat(chat.id)
        .catch(() => undefined);
  } catch (e) {
    toast.error(e);
    // Resync the window: the local removal / tombstone may be wrong.
    void useMessages
      .getState()
      .loadLatest(chat.id)
      .catch(() => undefined);
  }
}

/**
 * Delete Message. Space channels: for everyone after Discord's confirmation; other chats: the
 * "for everyone / for me" choice. `immediate` (Shift, as on Discord): no question — for everyone
 * when I may, else for me. Resolves true when deleted.
 */
export async function deleteMessage(
  chat: ChatSummary,
  m: ClientMessage,
  opts: { immediate?: boolean } = {},
): Promise<boolean> {
  const me = getMyId();
  if (!me) return false;
  if (isLocalId(m.id) || !isActionable(m)) return deleteMessages(chat, [m]);
  const everyone = canDeleteForEveryone(m, chat, me);
  if (isSpaceChatType(chat.type)) {
    if (!everyone) return false;
    if (
      !opts.immediate &&
      !(await confirm({
        title: 'Delete Message',
        message: 'Are you sure you want to delete this message?',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return false;
    await removeNow(chat, m, 'everyone');
    return true;
  }
  if (!opts.immediate) return deleteMessages(chat, [m]);
  await removeNow(chat, m, everyone ? 'everyone' : 'me');
  return true;
}

// ---------------------------------------------------------------------------
// Speak Message
// ---------------------------------------------------------------------------

export function canSpeak(m: ClientMessage): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance === 'function' &&
    !!copyText(m)
  );
}

/** Read the message aloud ("Ann said …"; broadcast channels are anonymous). */
export function speakMessage(chat: ChatSummary, m: ClientMessage): void {
  const text = copyText(m);
  if (!text || !canSpeak(m)) return;
  const who = chat.type !== 'channel' && m.senderId ? nameOf(m.senderId) : null;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(who ? `${who} said ${text}` : text));
}
