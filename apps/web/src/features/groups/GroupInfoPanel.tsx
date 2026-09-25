/**
 * PLACEHOLDER (agent 3 owns this file): group info (members, admins, settings, invite
 * link, leave/exit), shown by the conversation (agent 2) inside a <Sheet>.
 * Props contract: `{ chatId, onClose }` (same as ContactInfoPanel).
 * Tip: refetch members on `useBus('chat:members-changed', …)`.
 */
import { chatTitle } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import type { InfoPanelProps } from '@/features/contacts/ContactInfoPanel';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useChat } from '@/stores/chats';

export function GroupInfoPanel({ chatId, onClose }: InfoPanelProps) {
  const chat = useChat(chatId);
  const desktop = useIsDesktop();
  if (!chat) return null;
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader title="Group info" back={onClose} backIcon={desktop ? 'close' : 'arrow'} border />
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
        <ChatAvatar chat={chat} size="3xl" />
        <h2 className="mt-3 text-2xl font-semibold text-fg">{chatTitle(chat)}</h2>
        <p className="text-[15px] text-muted">Group · {chat.memberCount} members</p>
      </div>
      <Placeholder
        title="Group details"
        description="Description, members, admins, settings and invite link."
        owner="agent 3"
      />
    </div>
  );
}
