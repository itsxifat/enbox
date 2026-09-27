/**
 * Conversation UI state shared by the header, message list, bubbles and composer (not
 * server data): reply/edit targets, multi-select, jump/scroll requests, the highlighted
 * message and the message whose action menu is open. Keyed by chat id where it matters.
 */
import { create } from 'zustand';

import { registerSessionReset } from '@/lib/session';

let tokens = 0;

export const useConversationUi = create((set, get) => ({
  reply: {},
  editing: {},
  selecting: {},
  highlight: null,
  jump: null,
  bottomToken: 0,
  focusToken: 0,
  action: null,
  search: {},
  viewer: null,
  forward: null,
  info: null,

  setReply(chatId, m) {
    set((s) => ({
      reply: { ...s.reply, [chatId]: m ?? undefined },
      editing: m ? { ...s.editing, [chatId]: undefined } : s.editing,
      focusToken: m ? s.focusToken + 1 : s.focusToken,
    }));
  },
  setEditing(chatId, m) {
    set((s) => ({
      editing: { ...s.editing, [chatId]: m ?? undefined },
      reply: m ? { ...s.reply, [chatId]: undefined } : s.reply,
      focusToken: m ? s.focusToken + 1 : s.focusToken,
    }));
  },
  startSelect(chatId, messageId) {
    set((s) => ({ selecting: { ...s.selecting, [chatId]: messageId ? [messageId] : [] } }));
  },
  toggleSelect(chatId, messageId) {
    const cur = get().selecting[chatId];
    if (!cur) return;
    const next = cur.includes(messageId)
      ? cur.filter((id) => id !== messageId)
      : [...cur, messageId];
    set((s) => ({ selecting: { ...s.selecting, [chatId]: next } }));
  },
  clearSelect(chatId) {
    if (get().selecting[chatId] === undefined) return;
    set((s) => ({ selecting: { ...s.selecting, [chatId]: undefined } }));
  },
  requestJump(chatId, seq, messageId) {
    set({ jump: { chatId, seq, messageId, token: ++tokens } });
  },
  flash(messageId) {
    set({ highlight: { messageId, token: ++tokens } });
  },
  requestBottom() {
    set((s) => ({ bottomToken: s.bottomToken + 1 }));
  },
  focusComposer() {
    set((s) => ({ focusToken: s.focusToken + 1 }));
  },
  openActions(action) {
    set({ action });
  },
  setSearch(chatId, query) {
    set((s) => ({ search: { ...s.search, [chatId]: query } }));
  },
  openViewer(viewer) {
    set({ viewer });
  },
  openForward(forward) {
    set({ forward: forward?.length ? forward : null });
  },
  openInfo(info) {
    set({ info });
  },
}));

registerSessionReset(() =>
  useConversationUi.setState({
    reply: {},
    editing: {},
    selecting: {},
    highlight: null,
    jump: null,
    action: null,
    search: {},
    viewer: null,
    forward: null,
    info: null,
  }),
);

/** Is this message selected (select mode)? */
export function useIsSelected(chatId, messageId) {
  return useConversationUi((s) => !!s.selecting[chatId]?.includes(messageId));
}

export function useSelecting(chatId) {
  return useConversationUi((s) => s.selecting[chatId] !== undefined);
}
