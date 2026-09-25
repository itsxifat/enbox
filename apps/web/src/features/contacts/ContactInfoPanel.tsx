/**
 * PLACEHOLDER (agent 1 owns this file): contact info for a direct chat, shown by the
 * conversation (agent 2) inside a <Sheet>. Props are the contract: `{ chatId, onClose }`.
 * TODO(agent 1): about, phone, media/links/docs, common groups, mute, disappearing
 * messages, block/report, add/edit contact.
 */
import { chatTitle, type ID } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { formatLastSeen } from '@/lib/format';
import { useChat } from '@/stores/chats';
import { usePresence } from '@/stores/users';

export interface InfoPanelProps {
  chatId: ID;
  onClose: () => void;
}

export function ContactInfoPanel({ chatId, onClose }: InfoPanelProps) {
  const chat = useChat(chatId);
  const desktop = useIsDesktop();
  const presence = usePresence(chat?.peer?.id);
  if (!chat) return null;
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader
        title="Contact info"
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
      />
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
        <ChatAvatar chat={chat} size="3xl" />
        <h2 className="mt-3 text-2xl font-semibold text-fg">{chatTitle(chat)}</h2>
        {chat.peer ? <p className="text-[15px] text-muted">@{chat.peer.username}</p> : null}
        <p className="text-sm text-subtle">{formatLastSeen(presence)}</p>
      </div>
      <Placeholder
        title="Contact details"
        description="About, media, common groups, block and report."
        owner="agent 1"
      />
    </div>
  );
}
