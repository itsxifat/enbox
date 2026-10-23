/**
 * Mark the open conversation read on purpose (the new messages bar's Mark As Read, Escape):
 * read on the server like any read, and its NEW line and bar go away. The message list
 * watches the chat's token here.
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';
import { markChatRead } from '@/realtime/chats';

interface ReadSignalsState {
  /** Bumped per chat each time it is marked read on purpose. */
  tokens: Record<ID, number>;
}

export const useReadSignals = create<ReadSignalsState>(() => ({ tokens: {} }));

registerSessionReset(() => useReadSignals.setState({ tokens: {} }));

/** Dismiss the chat's NEW line and bar without reading it (the Space was marked read). */
export function signalRead(chatId: ID): void {
  useReadSignals.setState((s) => ({ tokens: { ...s.tokens, [chatId]: (s.tokens[chatId] ?? 0) + 1 } }));
}

export function markConversationRead(chatId: ID): void {
  markChatRead(chatId, { force: true });
  signalRead(chatId);
}
