/**
 * The Open Chat icon of a voice or Stage row in the channel sidebar (Discord: next to Invite
 * and Edit Channel, on hover or focus, always on the open row). Opens the channel's view with
 * its text chat beside it, without joining the call.
 */
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquare } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { openVoiceChat } from './actions';

export function OpenVoiceChatButton({ chat, active }: { chat: ChatSummary; active: boolean }) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Inside the row's link: neither follow it nor join the call.
    e.preventDefault();
    e.stopPropagation();
    openVoiceChat(chat, navigate);
  };
  return (
    <button
      type="button"
      aria-label={`Open chat in ${chat.name ?? 'channel'}`}
      title="Open Chat"
      // The row is `group/ch` (ChannelSidebar), like its Invite and Edit buttons.
      className={cn(
        'rounded p-0.5 text-muted hover:text-fg',
        active ? 'block' : 'hidden group-focus-within/ch:block group-hover/ch:block',
      )}
      onClick={onClick}
      data-testid="open-voice-chat"
    >
      <MessageSquare size={15} aria-hidden />
    </button>
  );
}
