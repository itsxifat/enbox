/**
 * PLACEHOLDER (agent 3 owns this file): channel view at /updates/channels/:chatId.
 * For now it reuses the conversation view (agent 2); agent 3 may wrap/replace it with the
 * channel-specific UI (follow button, reactions-only footer, admin composer).
 */
import { ConversationPane } from '@/features/conversation/ConversationPane';

export function ChannelPane() {
  return <ConversationPane />;
}
