/**
 * The Inbox's Unreads tab: every unread, unmuted chat from the chats store — Space text
 * channels and threads by Space, then DMs and groups — each with its newest unread messages
 * (the last PREVIEW_COUNT, fetched per card) and a check button that marks it read. Spaces
 * whose channels this session has not loaded yet are loaded when the tab opens (their unread
 * channels then appear). "Mark all as read" lives in the header (`MarkAllReadButton`).
 */
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Check,
  CheckCheck,
  Hash,
  MessagesSquare,
  PartyPopper,
  Podcast,
  Volume2,
} from 'lucide-react';
import { chatTitle, type ChatSummary, type ID, type Space } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Avatar, Button, EmptyState, IconButton, Spinner } from '@/components/ui';
import { registerSessionReset } from '@/lib/session';
import { markChatRead } from '@/realtime/chats';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useInbox } from '@/stores/inbox';
import { isSpaceMuted, useSpaces } from '@/stores/spaces';
import { openUnreadChat, unreadGroups, type UnreadGroup } from './lib';
import { MessagePreview } from './MessagePreview';

/** Spaces whose channels this tab asked for (once per session each). */
const requested = new Set<ID>();
registerSessionReset(() => requested.clear());

function useUnreadGroups(): UnreadGroup[] {
  const chats = useChats((s) => s.byId);
  const spaces = useSpaces((s) => s.byId);
  return useMemo(() => unreadGroups(chats, spaces), [chats, spaces]);
}

/** Load the channels of my unread Spaces this session has not loaded (rail aggregates only). */
function useLoadUnreadSpaces(): void {
  useEffect(() => {
    const st = useSpaces.getState();
    for (const s of Object.values(st.byId)) {
      if (st.channelsLoaded[s.id] || requested.has(s.id) || isSpaceMuted(s)) continue;
      if (!s.unread && !s.unreadMentionCount) continue;
      requested.add(s.id);
      void st.loadSpace(s.id).catch(() => requested.delete(s.id));
    }
  }, []);
}

export function MarkAllReadButton() {
  const groups = useUnreadGroups();
  const chats = groups.flatMap((g) => g.chats);
  return (
    <Button
      size="sm"
      variant="secondary"
      leftIcon={CheckCheck}
      disabled={!chats.length}
      onClick={() => {
        for (const c of chats) markChatRead(c.id, { force: true });
      }}
    >
      Mark all as read
    </Button>
  );
}

function UnreadCard({
  chat,
  space,
  onOpen,
}: {
  chat: ChatSummary;
  space: Space | null;
  onOpen: () => void;
}) {
  const me = useAuth((s) => s.user?.id);
  const preview = useInbox((s) => s.previews[chat.id]);
  useEffect(() => {
    void useInbox.getState().loadPreview(chat.id, chat.lastSeq);
  }, [chat.id, chat.lastSeq]);
  const title = chat.space ? (chat.name ?? 'Untitled') : chatTitle(chat, me);
  // The unread ones among the newest messages (all of them when the read marker is off).
  const shown = useMemo(() => {
    const list = preview?.messages ?? [];
    const unread = list.filter((m) => m.seq > chat.lastReadSeq);
    return unread.length ? unread : list;
  }, [preview, chat.lastReadSeq]);
  const Icon =
    chat.type === 'space_thread'
      ? MessagesSquare
      : chat.type === 'space_stage'
        ? Podcast
        : chat.type === 'space_voice'
          ? Volume2
          : Hash;
  return (
    <section
      className="card-inset overflow-hidden"
      aria-label={title}
      data-testid="inbox-unread"
      data-chat-id={chat.id}
    >
      <header className="flex min-w-0 items-center gap-1.5 py-1.5 pr-1.5 pl-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {chat.space ? (
            <Icon size={16} className="shrink-0 text-muted" aria-hidden />
          ) : (
            <ChatAvatar chat={chat} size={20} />
          )}
          <span className="truncate text-[14px] font-semibold text-fg">{title}</span>
          {chat.unreadMentionCount > 0 ? (
            <span
              className="shrink-0 rounded-full bg-danger-fill px-1.5 text-[11px] leading-[18px] font-semibold text-white"
              aria-label={`${chat.unreadMentionCount} mentions`}
            >
              @{chat.unreadMentionCount}
            </span>
          ) : null}
        </button>
        <IconButton
          icon={Check}
          label={`Mark ${title} as read`}
          size="sm"
          variant="ghost"
          onClick={() => markChatRead(chat.id, { force: true })}
        />
      </header>
      <div className="pb-1.5">
        {!preview ? (
          <div className="flex justify-center py-2">
            <Spinner size={16} className="text-muted" label="Loading messages" />
          </div>
        ) : (
          shown.map((m) => (
            <div key={m.id} className="px-3 py-1.5">
              <MessagePreview message={m} spaceId={space?.id ?? null} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function UnreadsTab({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const groups = useUnreadGroups();
  useLoadUnreadSpaces();
  const open = (chat: ChatSummary) => {
    onClose();
    openUnreadChat(chat, navigate);
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
      {groups.length ? (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.space ? g.space.name : 'Direct Messages'}>
              <h3 className="mb-1.5 flex min-w-0 items-center gap-2 px-1 section-label">
                {g.space ? (
                  <Avatar
                    src={g.space.iconUrl}
                    name={g.space.name}
                    colorSeed={g.space.id}
                    size={18}
                    kind="community"
                    decorative
                  />
                ) : null}
                <span className="truncate">{g.space ? g.space.name : 'Direct Messages'}</span>
              </h3>
              <div className="flex flex-col gap-2">
                {g.chats.map((c) => (
                  <UnreadCard key={c.id} chat={c} space={g.space} onOpen={() => open(c)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={PartyPopper}
          title="You’re all caught up!"
          description="Nothing unread right now."
        />
      )}
    </div>
  );
}
