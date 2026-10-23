/**
 * Opening and closing the text chat of a voice or Stage channel (the side panel
 * `{ kind: 'voiceChat', channelId }`, full screen on phones). See store.ts for what is
 * remembered.
 */
import type { NavigateFunction } from 'react-router';
import type { ChatSummary, ID } from '@enbox/shared';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { useConversationUi } from '@/features/conversation/state';
import { useSidePanel } from '@/stores/sidePanel';
import { useVoiceChat } from './store';

/** Whether the side panel shows this channel's chat. */
export function isVoiceChatShown(channelId: ID): boolean {
  const p = useSidePanel.getState().panel;
  return p?.kind === 'voiceChat' && p.channelId === channelId;
}

/** Show the chat beside its channel's view (that view is on screen); remembered for it. */
export function showVoiceChat(channelId: ID): void {
  useVoiceChat.getState().remember(channelId, true);
  if (!isVoiceChatShown(channelId)) useSidePanel.getState().open({ kind: 'voiceChat', channelId });
}

/** Close it (its ✕, the Chat button): forgotten for the channel too. */
export function hideVoiceChat(channelId: ID): void {
  // Forget first: the view re-opens a remembered chat whenever the side panel empties.
  useVoiceChat.getState().remember(channelId, false);
  if (isVoiceChatShown(channelId)) useSidePanel.getState().close();
}

/** Close it without forgetting it (its view went away; coming back shows it again). */
export function dismissVoiceChat(channelId: ID): void {
  if (isVoiceChatShown(channelId)) useSidePanel.getState().close();
}

/**
 * Open a voice or Stage channel's chat from anywhere (the sidebar's Open Chat icon, the
 * Inbox): its view opens (navigating there unless it is on screen) with the chat beside it,
 * full screen on phones; at `target` when given (the list scrolls there and highlights it).
 */
export function openVoiceChat(
  chat: Pick<ChatSummary, 'id' | 'space'>,
  navigate: NavigateFunction,
  target?: { seq: number; messageId?: ID },
): void {
  const spaceId = chat.space?.spaceId;
  if (!spaceId) return;
  if (target) useConversationUi.getState().requestJump(chat.id, target.seq, target.messageId);
  if (useVoiceChat.getState().viewing === chat.id) {
    showVoiceChat(chat.id);
    return;
  }
  useVoiceChat.setState({ pending: chat.id });
  void navigate(`/spaces/${spaceId}/${chat.id}`, { state: IN_APP_NAV });
}
