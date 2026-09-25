/**
 * Conversation UI state shared by the header, message list, bubbles and composer (not
 * server data): reply/edit targets, multi-select, jump/scroll requests, the highlighted
 * message and the message whose action menu is open. Keyed by chat id where it matters.
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';
import type { ClientMessage } from '@/stores/messages';

export type ActionAnchor = HTMLElement | { x: number; y: number };

export interface ActionTarget {
  chatId: ID;
  messageId: ID;
  anchor: ActionAnchor;
  /** menu = desktop dropdown/context menu, sheet = touch long-press, react = reaction picker. */
  mode: 'menu' | 'sheet' | 'react';
}

export interface JumpRequest {
  chatId: ID;
  seq: number;
  messageId?: ID;
  token: number;
}

interface ConversationUiState {
  reply: Record<ID, ClientMessage | undefined>;
  editing: Record<ID, ClientMessage | undefined>;
  /** Selected message ids while in select mode (undefined = not selecting). */
  selecting: Record<ID, ID[] | undefined>;
  highlight: { messageId: ID; token: number } | null;
  jump: JumpRequest | null;
  /** Bumped to ask the list to scroll to the newest message. */
  bottomToken: number;
  /** Bumped to focus the composer (after picking reply/edit). */
  focusToken: number;
  action: ActionTarget | null;
  /** In-chat search query (highlighted in bubbles); null = search closed. */
  search: Record<ID, string | null | undefined>;
  /** Media viewer (lightbox) opened on a message. */
  viewer: { chatId: ID; messageId: ID } | null;
  /** Forward dialog for these messages (in list order). */
  forward: ClientMessage[] | null;
  /** Message info sheet. */
  info: ClientMessage | null;

  setReply(chatId: ID, m: ClientMessage | null): void;
  setEditing(chatId: ID, m: ClientMessage | null): void;
  startSelect(chatId: ID, messageId?: ID): void;
  toggleSelect(chatId: ID, messageId: ID): void;
  clearSelect(chatId: ID): void;
  requestJump(chatId: ID, seq: number, messageId?: ID): void;
  flash(messageId: ID): void;
  requestBottom(): void;
  focusComposer(): void;
  openActions(target: ActionTarget | null): void;
  setSearch(chatId: ID, query: string | null): void;
  openViewer(v: { chatId: ID; messageId: ID } | null): void;
  openForward(messages: ClientMessage[] | null): void;
  openInfo(m: ClientMessage | null): void;
}

let tokens = 0;

export const useConversationUi = create<ConversationUiState>((set, get) => ({
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
export function useIsSelected(chatId: ID, messageId: ID): boolean {
  return useConversationUi((s) => !!s.selecting[chatId]?.includes(messageId));
}

export function useSelecting(chatId: ID): boolean {
  return useConversationUi((s) => s.selecting[chatId] !== undefined);
}
