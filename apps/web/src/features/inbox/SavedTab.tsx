/**
 * The Inbox's Bookmarks and Reminders tabs (features/bookmarks): my saved messages, newest
 * first, or the ones with a reminder — upcoming soonest first, then the done ones, greyed. Each
 * card says where the message is ("#channel · Space", the DM or group) and offers Jump, Remind
 * Me ▸ and Remove. Live from the bookmarks store; showing a tab refreshes a list older than
 * REFRESH_AFTER_MS. The Reminders tab marks the fired reminders it shows as seen (the Inbox
 * badge counts the others); those stay highlighted while it is open.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlarmClock,
  Bookmark as BookmarkIcon,
  Hash,
  MessagesSquare,
  Podcast,
  Volume2,
  X,
} from 'lucide-react';
import type { Bookmark, ChatSummary, ID } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { Avatar, Button, DropdownMenu, EmptyState, IconButton, Spinner } from '@/components/ui';
import { removeBookmark, type BookmarkTarget } from '@/features/bookmarks/actions';
import { reminderEntries } from '@/features/bookmarks/bookmarkMenu';
import { formatReminderTime } from '@/features/bookmarks/reminders';
import {
  bookmarkList,
  dueReminders,
  reminderKey,
  reminderList,
  useBookmarks,
} from '@/features/bookmarks/store';
import { useChatTitle } from '@/features/groupDms/title';
import { cn } from '@/lib/cn';
import { registerSessionReset } from '@/lib/session';
import { useChat, useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { jumpToMessage } from './lib';
import { MessagePreview } from './MessagePreview';

export type SavedMode = 'bookmarks' | 'reminders';

/** A list older than this reloads when a tab shows it. */
const REFRESH_AFTER_MS = 30_000;

/** Chats asked for once this session (a saved message in a chat the list doesn't have). */
const requested = new Set<ID>();
registerSessionReset(() => requested.clear());

function useChatOf(chatId: ID): ChatSummary | undefined {
  const chat = useChat(chatId);
  useEffect(() => {
    if (chat || requested.has(chatId)) return;
    requested.add(chatId);
    void useChats
      .getState()
      .refreshChat(chatId)
      .catch(() => undefined);
  }, [chat, chatId]);
  return chat;
}

function channelIcon(type: ChatSummary['type']) {
  if (type === 'space_voice') return Volume2;
  if (type === 'space_stage') return Podcast;
  if (type === 'space_thread') return MessagesSquare;
  return Hash;
}

/** Where a saved message is: "#channel in #parent · Space", or the DM / group. */
function Place({ chat }: { chat: ChatSummary }) {
  const space = useSpaces((s) => (chat.space ? s.byId[chat.space.spaceId] : undefined));
  const title = useChatTitle(chat);
  const parentName = useChats((s) =>
    chat.type === 'space_thread' && chat.thread?.parentId
      ? (s.byId[chat.thread.parentId]?.name ?? null)
      : null,
  );
  if (!chat.space) {
    return (
      <>
        <ChatAvatar chat={chat} size={18} />
        <span className="truncate text-[14px] font-semibold text-fg">{title}</span>
      </>
    );
  }
  const Icon = channelIcon(chat.type);
  return (
    <>
      {space ? (
        <Avatar
          src={space.iconUrl}
          name={space.name}
          colorSeed={space.id}
          size={18}
          kind="community"
          decorative
        />
      ) : null}
      <Icon size={16} className="shrink-0 text-muted" aria-hidden />
      <span className="truncate text-[14px] font-semibold text-fg">{chat.name ?? 'Untitled'}</span>
      {parentName ? (
        <span className="shrink-0 text-[12.5px] text-muted">in #{parentName}</span>
      ) : null}
      {space ? (
        <span className="min-w-0 truncate text-[12.5px] text-muted">
          <span aria-hidden>· </span>
          {space.name}
        </span>
      ) : null}
    </>
  );
}

function SavedCard({
  bookmark: b,
  due,
  greyed,
  onJump,
}: {
  bookmark: Bookmark;
  /** A reminder that just fired (highlighted). */
  due: boolean;
  greyed: boolean;
  onJump: () => void;
}) {
  const chat = useChatOf(b.chatId);
  const target: BookmarkTarget = { messageId: b.messageId, chatId: b.chatId, message: b.message };
  return (
    <section
      className={cn('group/saved card-inset relative overflow-hidden', greyed && 'opacity-60')}
      data-testid="inbox-bookmark"
      data-message-id={b.messageId}
      aria-label={chat ? (chat.name ?? 'Saved message') : 'Saved message'}
    >
      <header className="flex min-w-0 items-center gap-1.5 px-3 pt-2.5 pb-1">
        {chat ? (
          <Place chat={chat} />
        ) : (
          <span className="truncate text-[14px] font-semibold text-muted">Saved message</span>
        )}
      </header>
      <div className="px-3 pb-2.5">
        {b.message ? (
          <MessagePreview message={b.message} spaceId={chat?.space?.spaceId ?? null} />
        ) : (
          <p className="text-[14px] text-muted italic">This message is no longer available</p>
        )}
        {b.remindAt ? (
          <p
            className={cn(
              'mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium',
              b.remindedAt && !due ? 'text-muted' : 'text-brand-ink',
            )}
          >
            <AlarmClock size={14} aria-hidden />
            {b.remindedAt
              ? `Reminded ${formatReminderTime(b.remindedAt)}`
              : `Reminder: ${formatReminderTime(b.remindAt)}`}
            {due ? (
              <span className="rounded-full bg-danger-fill px-1.5 text-[11px] leading-[18px] font-semibold text-white">
                Due
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          'absolute top-1.5 right-2 flex items-center gap-1 rounded-full bg-elevated p-0.5 shadow-sm',
          // Always shown on touch screens; on hover / keyboard focus elsewhere.
          'lg:opacity-0 lg:group-hover/saved:opacity-100 lg:focus-within:opacity-100',
        )}
      >
        {b.message ? (
          <>
            <Button size="sm" variant="secondary" onClick={onJump}>
              Jump
            </Button>
            <DropdownMenu
              aria-label="Remind me"
              items={reminderEntries(target)}
              trigger={(p) => (
                <IconButton {...p} icon={AlarmClock} label="Remind me" size="xs" variant="solid" />
              )}
            />
          </>
        ) : null}
        <IconButton
          icon={X}
          label="Remove bookmark"
          size="xs"
          variant="solid"
          onClick={() => void removeBookmark(b.messageId)}
        />
      </div>
    </section>
  );
}

export function SavedTab({ mode, onClose }: { mode: SavedMode; onClose: () => void }) {
  const navigate = useNavigate();
  const byId = useBookmarks((s) => s.byId);
  const loaded = useBookmarks((s) => s.loaded);
  const loading = useBookmarks((s) => s.loading);
  const error = useBookmarks((s) => s.error);
  const items = useMemo(
    () => (mode === 'bookmarks' ? bookmarkList(byId) : reminderList(byId)),
    [mode, byId],
  );
  // The fired reminders I haven't seen (from the first frame on).
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(() => {
    const s = useBookmarks.getState();
    return new Set(mode === 'reminders' ? dueReminders(s.byId, s.seen).map(reminderKey) : []);
  });

  useEffect(() => {
    const s = useBookmarks.getState();
    if (!s.loaded || Date.now() - s.loadedAt > REFRESH_AFTER_MS) void s.load();
  }, []);

  // Shown here: seen (the badge drops them), highlighted while the tab stays open.
  useEffect(() => {
    if (mode !== 'reminders') return;
    const s = useBookmarks.getState();
    const keys = dueReminders(byId, s.seen).map(reminderKey);
    if (keys.length === 0) return;
    setHighlight((h) => new Set([...h, ...keys]));
    s.markSeen(keys);
  }, [mode, byId]);

  const jump = (b: Bookmark) => {
    if (!b.message) return;
    onClose();
    void jumpToMessage(b.chatId, b.message, (to) => void navigate(to, { state: IN_APP_NAV }));
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin"
      aria-busy={loading || undefined}
    >
      {items.length ? (
        <div className="flex flex-col gap-2">
          {items.map((b) => {
            const due = highlight.has(reminderKey(b));
            return (
              <SavedCard
                key={b.messageId}
                bookmark={b}
                due={due}
                greyed={mode === 'reminders' && !!b.remindedAt && !due}
                onJump={() => jump(b)}
              />
            );
          })}
        </div>
      ) : !loaded && error ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-[14px] text-danger">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void useBookmarks.getState().load()}>
            Try again
          </Button>
        </div>
      ) : !loaded ? (
        <div className="flex justify-center py-6">
          <Spinner size={22} className="text-brand-ink" />
        </div>
      ) : mode === 'bookmarks' ? (
        <EmptyState
          icon={BookmarkIcon}
          title="No bookmarks yet"
          description="Bookmark a message from its menu to find it here later."
        />
      ) : (
        <EmptyState
          icon={AlarmClock}
          title="No reminders"
          description="Use Remind Me on a message and it shows up here."
        />
      )}
    </div>
  );
}
