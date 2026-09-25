/**
 * PLACEHOLDER (agent 3 owns this file): channel info (description, followers, admins,
 * settings, share link, unfollow), shown by the conversation/channel view in a <Sheet>.
 * Props contract: `{ chatId, onClose }`.
 */
import { chatTitle } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import type { InfoPanelProps } from '@/features/contacts/ContactInfoPanel';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { formatCount } from '@/lib/format';
import { useChat } from '@/stores/chats';

export function ChannelInfoPanel({ chatId, onClose }: InfoPanelProps) {
  const chat = useChat(chatId);
  const desktop = useIsDesktop();
  if (!chat) return null;
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader
        title="Channel info"
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
      />
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
        <ChatAvatar chat={chat} size="3xl" />
        <h2 className="mt-3 text-2xl font-semibold text-fg">{chatTitle(chat)}</h2>
        <p className="text-[15px] text-muted">
          Channel · {formatCount(chat.memberCount)} followers
        </p>
      </div>
      <Placeholder
        title="Channel details"
        description="Description, admins, settings and share link."
        owner="agent 3"
      />
    </div>
  );
}
