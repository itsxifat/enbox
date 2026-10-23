/**
 * The Chat button of a voice or Stage channel's view (Discord's "Show Chat" in the call
 * header): toggles the channel's text chat beside the view (full screen on phones), with the
 * unread dot (or the mention count) while the chat is closed. Mounted with the view, it also
 * opens the chat when something asks for it:
 * - a jump into the chat (search, the Inbox, a message link; `?m=<seq>&mid=<id>` in the URL,
 *   then dropped from it), at that message;
 * - `openVoiceChat` from elsewhere (the sidebar's Open Chat icon);
 * - desktop: a chat I left open here earlier, whenever the side panel is free.
 * Leaving the view closes the chat (still remembered on desktop).
 */
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { MessageSquare } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { Badge, IconButton } from '@/components/ui';
import { useConversationUi } from '@/features/conversation/state';
import { isChannelUnread } from '@/features/spaces/sidebar';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { lazyNamed } from '@/lib/lazy';
import { useChats } from '@/stores/chats';
import { useSidePanel } from '@/stores/sidePanel';
import { dismissVoiceChat, hideVoiceChat, isVoiceChatShown, showVoiceChat } from './actions';
import { useVoiceChat } from './store';

const VoiceChatPanel = lazyNamed(() => import('./VoiceChatPanel'), 'VoiceChatPanel');

export function VoiceChatButton({ chat }: { chat: ChatSummary }) {
  const desktop = useIsDesktop();
  const open = useSidePanel((s) => s.panel?.kind === 'voiceChat' && s.panel.channelId === chat.id);
  useChatRequests(chat, desktop);
  // While closed: the mention count, else a dot for unread messages (as the sidebar row).
  const mentions = open ? 0 : chat.unreadMentionCount;
  const unread = !open && mentions === 0 && isChannelUnread(chat);
  const state = mentions > 0 ? `, ${mentions} unread mentions` : unread ? ', unread messages' : '';
  return (
    <>
      <IconButton
        icon={MessageSquare}
        // A toggle: the name stays, `aria-pressed` tells whether it is open.
        label={`Chat${state}`}
        title={open ? 'Hide Chat' : 'Show Chat'}
        variant="ghost"
        active={open}
        aria-pressed={open}
        badge={
          mentions > 0 ? (
            <Badge count={mentions} size="sm" tone="danger" />
          ) : unread ? (
            <Badge dot size="sm" className="ring-2 ring-surface" />
          ) : null
        }
        onClick={() => (open ? hideVoiceChat(chat.id) : showVoiceChat(chat.id))}
        data-testid="voice-chat-button"
        data-unread={unread || mentions > 0 ? 'true' : undefined}
      />
      {!desktop && open ? (
        <Suspense fallback={null}>
          <VoiceChatPanel channelId={chat.id} overlay />
        </Suspense>
      ) : null}
    </>
  );
}

/** What opens this channel's chat while its view is on screen (see the header). */
function useChatRequests(chat: ChatSummary, desktop: boolean): void {
  const channelId = chat.id;

  // On screen: `openVoiceChat` needs no navigation to get here. A request for another channel
  // whose view never showed is stale.
  useEffect(() => {
    const stale = useVoiceChat.getState().pending !== channelId;
    useVoiceChat.setState(stale ? { viewing: channelId, pending: null } : { viewing: channelId });
    return () => {
      if (useVoiceChat.getState().viewing === channelId) useVoiceChat.setState({ viewing: null });
    };
  }, [channelId]);

  // While closed the chat is not the open conversation (whatever set it: the channel route), so
  // its new messages stay unread and show on this button; the panel sets it while shown.
  useEffect(
    () =>
      useChats.subscribe((s) => {
        if (s.openChatId === channelId && !isVoiceChatShown(channelId)) s.setOpenChat(null);
      }),
    [channelId],
  );

  // `openVoiceChat` from elsewhere (it navigated here).
  const pending = useVoiceChat((s) => s.pending === channelId);
  useEffect(() => {
    if (!pending) return;
    useVoiceChat.setState({ pending: null });
    showVoiceChat(channelId);
  }, [pending, channelId]);

  // `?m=<seq>&mid=<id>` links (search results, the Inbox, notifications): a jump, then off the URL.
  const [params, setParams] = useSearchParams();
  const seq = Number(params.get('m'));
  const linked = Number.isInteger(seq) && seq > 0 ? seq : null;
  const messageId = params.get('mid') ?? undefined;
  useEffect(() => {
    if (linked === null) return;
    useConversationUi.getState().requestJump(channelId, linked, messageId);
    const next = new URLSearchParams(params);
    next.delete('m');
    next.delete('mid');
    setParams(next, { replace: true });
    // Once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, messageId, channelId]);

  // A jump into this chat opens it (its list then scrolls there).
  const jump = useConversationUi((s) => (s.jump?.chatId === channelId ? s.jump.token : null));
  useEffect(() => {
    if (jump !== null) showVoiceChat(channelId);
  }, [jump, channelId]);

  // Desktop: the chat I left open here shows whenever the side panel is free. Leaving the view
  // closes it (unsubscribed first, or the close would re-open it).
  useEffect(() => {
    const restore = () => {
      if (!useSidePanel.getState().panel && useVoiceChat.getState().open[channelId])
        useSidePanel.getState().open({ kind: 'voiceChat', channelId });
    };
    const unsubscribe = desktop ? useSidePanel.subscribe(restore) : undefined;
    if (desktop) restore();
    return () => {
      unsubscribe?.();
      dismissVoiceChat(channelId);
    };
  }, [desktop, channelId]);
}
