import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Bell, Hash, Search, Settings, Users } from 'lucide-react';
import { PERM, hasPerm, type ChatSummary, type Space } from '@enbox/shared';
import { EmptyState, IconButton, PageSpinner, Sheet } from '@/components/ui';
import { Conversation } from '@/features/conversation/ConversationPane';
import { useConversationUi } from '@/features/conversation/state';
import { VoiceChannelView } from '@/features/voice/VoiceChannelView';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { focusSpaceChannel } from '@/realtime/spaces';
import { useChat, useChats } from '@/stores/chats';
import { useSpace, useSpaces } from '@/stores/spaces';
import { spaceMemory } from './actions';
import { ChannelDialog } from './dialogs/ChannelDialog';
import { NotificationDialog } from './dialogs/NotificationDialog';
import { MemberList } from './MemberList';
import { useSpacesUi } from './ui';

function ChannelHeader({ chat, space }: { chat: ChatSummary; space: Space }) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const ui = useSpacesUi();
  const [topicOpen, setTopicOpen] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'notifications' | 'members' | null>(null);
  const canManage = hasPerm(chat.spacePermissions, PERM.MANAGE_CHANNELS);
  const topic = chat.space?.topic;
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]" data-testid="space-channel-header">
      {desktop ? null : (
        <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => navigate(`/spaces/${space.id}`)} />
      )}
      <Hash size={22} className="shrink-0 text-muted" aria-hidden />
      <h1 className="shrink-0 truncate text-[16px] font-bold text-fg">{chat.name}</h1>
      {topic ? (
        <>
          <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
          <button
            type="button"
            onClick={() => setTopicOpen((o) => !o)}
            className="hidden min-w-0 flex-1 truncate text-left text-[14px] text-muted hover:text-fg sm:block"
            title={topic}
          >
            {topic}
          </button>
        </>
      ) : (
        <div className="flex-1" />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton
          icon={Search}
          label="Search this channel"
          variant="ghost"
          onClick={() => useConversationUi.getState().setSearch(chat.id, '')}
        />
        <IconButton icon={Bell} label="Notification settings" variant="ghost" onClick={() => setDialog('notifications')} />
        {canManage ? (
          <IconButton icon={Settings} label="Edit channel" variant="ghost" onClick={() => setDialog('settings')} />
        ) : null}
        <IconButton
          icon={Users}
          label={ui.canShowMembers ? (ui.membersOpen ? 'Hide member list' : 'Show member list') : 'Members'}
          variant="ghost"
          active={ui.membersOpen}
          onClick={() => (ui.canShowMembers ? ui.toggleMembers() : setDialog('members'))}
        />
      </div>
      {topicOpen && topic ? (
        <div role="dialog" aria-label="Channel topic" className="absolute top-14 right-3 left-3 z-20 rounded-xl bg-elevated p-4 text-[14px] text-fg shadow-elevated">
          <p className="mb-1 font-bold">#{chat.name}</p>
          <p className="whitespace-pre-wrap text-muted">{topic}</p>
        </div>
      ) : null}
      {dialog === 'settings' ? <ChannelDialog spaceId={space.id} chat={chat} onClose={() => setDialog(null)} /> : null}
      {dialog === 'notifications' ? <NotificationDialog space={space} chat={chat} onClose={() => setDialog(null)} /> : null}
      <Sheet open={dialog === 'members'} onClose={() => setDialog(null)} aria-label="Members">
        <MemberList spaceId={space.id} inSheet />
      </Sheet>
    </header>
  );
}

/** /spaces/:spaceId/:chatId — a text channel (the shared conversation view) or a voice channel. */
export function SpaceChannelPane() {
  const { spaceId, chatId } = useParams<{ spaceId: string; chatId: string }>();
  const [params] = useSearchParams();
  const chat = useChat(chatId);
  const space = useSpace(spaceId);
  const channelsLoaded = useSpaces((s) => (spaceId ? !!s.channelsLoaded[spaceId] : false));

  useEffect(() => {
    if (!chatId || !spaceId) return;
    spaceMemory.setLastChannel(spaceId, chatId);
    useChats.getState().setOpenChat(chatId);
    focusSpaceChannel(chatId);
    return () => {
      if (useChats.getState().openChatId === chatId) useChats.getState().setOpenChat(null);
      focusSpaceChannel(null);
    };
  }, [chatId, spaceId]);

  if (!space || !chat) {
    if (!channelsLoaded) return <PageSpinner />;
    // Gone (deleted, no access): back to the Space.
    return <Navigate to={space ? `/spaces/${spaceId}` : '/spaces'} replace />;
  }
  if (chat.space?.spaceId !== space.id) return <Navigate to={`/spaces/${chat.space?.spaceId ?? ''}/${chat.id}`} replace />;
  if (chat.type === 'space_voice') return <VoiceChannelView chat={chat} space={space} />;
  const seq = Number(params.get('m'));
  const target = Number.isInteger(seq) && seq > 0 ? { seq, messageId: params.get('mid') ?? undefined } : null;
  return <Conversation key={chat.id} chat={chat} initialTarget={target} header={<ChannelHeader chat={chat} space={space} />} />;
}

/** /spaces/:spaceId — the last channel I had open there, else its first text channel. */
export function SpaceHome() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const space = useSpace(spaceId);
  const loaded = useSpaces((s) => s.loaded);
  const channelsLoaded = useSpaces((s) => (spaceId ? !!s.channelsLoaded[spaceId] : false));
  const byId = useChats((s) => s.byId);
  const desktop = useIsDesktop();
  if (!spaceId) return <Navigate to="/spaces" replace />;
  if (loaded && !space) return <Navigate to="/spaces" replace />;
  if (!channelsLoaded) return desktop ? <PageSpinner /> : null;
  // Phones show the channel list (the Space view) — only desktop jumps into a channel.
  if (!desktop) return null;
  const last = spaceMemory.lastChannel(spaceId);
  const channels = Object.values(byId).filter((c) => c.space?.spaceId === spaceId);
  const target =
    channels.find((c) => c.id === last) ??
    channels
      .filter((c) => c.type === 'space_text')
      .sort((a, b) => (a.space!.position - b.space!.position))[0];
  if (target) return <Navigate to={`/spaces/${spaceId}/${target.id}`} replace />;
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState icon={Hash} title="No text channels yet" description="Create one from the Space menu." />
    </div>
  );
}
