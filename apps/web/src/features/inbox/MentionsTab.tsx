/**
 * The Inbox's Mentions tab: messages of the last 30 days that mention me (GET /api/me/mentions),
 * newest first, one card per run of the same channel ("#channel · Space"), Jump to open the
 * message and ✕ to dismiss it on this device. Infinite scroll; the filters live in the header
 * (`MentionsFilterMenu`).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { AtSign, Hash, ListFilter, MessagesSquare, Podcast, Users, Volume2, X } from 'lucide-react';
import type { ID, InboxMention } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Avatar, Button, DropdownMenu, EmptyState, IconButton, Spinner, type MenuEntry } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useChat } from '@/stores/chats';
import { mentionsQuery, mentionsQueryKey, useInbox } from '@/stores/inbox';
import { INBOX_MENTION_DAYS, groupMentions, jumpToMention, type MentionGroup } from './lib';
import { MessagePreview } from './MessagePreview';

/** Load the next page when the reader is this close to the bottom (px). */
const MORE_THRESHOLD = 240;

function chatIcon(type: InboxMention['chat']['type']) {
  if (type === 'space_voice') return Volume2;
  if (type === 'space_stage') return Podcast;
  if (type === 'space_thread') return MessagesSquare;
  if (type === 'group') return Users;
  return Hash;
}

/** The filters (header): @everyone/@here, role mentions, This Space only / All Spaces. */
export function MentionsFilterMenu({ spaceId }: { spaceId: ID | null }) {
  const filters = useInbox((s) => s.filters);
  const set = useInbox((s) => s.setFilters);
  const thisSpace = filters.thisSpace && !!spaceId;
  const items: MenuEntry[] = [
    {
      label: 'Include @everyone and @here',
      checked: filters.everyone,
      keepOpen: true,
      onSelect: () => set({ everyone: !filters.everyone }),
    },
    {
      label: 'Include role mentions',
      checked: filters.roles,
      keepOpen: true,
      onSelect: () => set({ roles: !filters.roles }),
    },
    'separator',
    {
      label: 'This Space only',
      description: spaceId ? undefined : 'Open a Space to use this',
      radio: true,
      checked: thisSpace,
      disabled: !spaceId,
      keepOpen: true,
      onSelect: () => set({ thisSpace: true }),
    },
    {
      label: 'All Spaces',
      radio: true,
      checked: !thisSpace,
      keepOpen: true,
      onSelect: () => set({ thisSpace: false }),
    },
  ];
  return (
    <DropdownMenu
      aria-label="Mention filters"
      items={items}
      trigger={(p) => <IconButton {...p} icon={ListFilter} label="Filter mentions" size="sm" />}
    />
  );
}

function MentionCard({ group, onJump }: { group: MentionGroup; onJump: (item: InboxMention) => void }) {
  const { chat } = group;
  // Groups wear their own picture when the chat list has it.
  const cached = useChat(chat.type === 'group' ? chat.id : null);
  const Icon = chatIcon(chat.type);
  const name = chat.name ?? 'Untitled';
  const where = chat.type === 'space_thread' && chat.parentName ? `#${chat.parentName}` : null;
  return (
    <section className="card-inset overflow-hidden" aria-label={`${name}${chat.spaceName ? `, ${chat.spaceName}` : ''}`} data-testid="inbox-mention-card">
      <header className="flex min-w-0 items-center gap-1.5 px-3 pt-2.5 pb-1">
        {chat.spaceId ? (
          <Avatar src={chat.spaceIconUrl} name={chat.spaceName ?? 'Space'} colorSeed={chat.spaceId} size={18} kind="community" decorative />
        ) : null}
        {cached ? <ChatAvatar chat={cached} size={18} /> : <Icon size={16} className="shrink-0 text-muted" aria-hidden />}
        <span className="truncate text-[14px] font-semibold text-fg">{name}</span>
        {where ? <span className="shrink-0 text-[12.5px] text-muted">in {where}</span> : null}
        {chat.spaceName ? (
          <span className="min-w-0 truncate text-[12.5px] text-muted">
            <span aria-hidden>· </span>
            {chat.spaceName}
          </span>
        ) : null}
      </header>
      <div className="pb-1">
        {group.items.map((item) => (
          <MentionRow key={item.message.id} item={item} onJump={() => onJump(item)} />
        ))}
      </div>
    </section>
  );
}

function MentionRow({ item, onJump }: { item: InboxMention; onJump: () => void }) {
  const dismiss = useInbox((s) => s.dismiss);
  return (
    <div className="group/mention relative px-3 py-2 hover:bg-hover" data-testid="inbox-mention" data-message-id={item.message.id}>
      <MessagePreview message={item.message} spaceId={item.chat.spaceId} />
      <div
        className={cn(
          'absolute top-1.5 right-2 flex items-center gap-1 rounded-full bg-elevated p-0.5 shadow-sm',
          // Always shown on touch screens; on hover / keyboard focus elsewhere.
          'lg:opacity-0 lg:group-hover/mention:opacity-100 lg:focus-within:opacity-100',
        )}
      >
        <Button size="sm" variant="secondary" onClick={onJump}>
          Jump
        </Button>
        <IconButton icon={X} label="Dismiss mention" size="xs" variant="solid" onClick={() => dismiss(item.message.id)} />
      </div>
    </div>
  );
}

export function MentionsTab({ spaceId, onClose }: { spaceId: ID | null; onClose: () => void }) {
  const navigate = useNavigate();
  const feed = useInbox((s) => s.feed);
  const filters = useInbox((s) => s.filters);
  const dismissed = useInbox((s) => s.dismissed);
  const key = mentionsQueryKey(mentionsQuery(filters, spaceId));
  const spaceRef = useRef(spaceId);
  spaceRef.current = spaceId;

  // The first page whenever the tab shows or the query changes (stale items stay meanwhile).
  useEffect(() => {
    void useInbox.getState().loadMentions(spaceRef.current);
  }, [key]);

  const current = feed.key === key;
  const items = useMemo(() => {
    if (!current) return [];
    const gone = new Set(dismissed);
    return feed.items.filter((i) => !gone.has(i.message.id));
  }, [current, feed.items, dismissed]);
  const groups = useMemo(() => groupMentions(items), [items]);

  const scroller = useRef<HTMLDivElement>(null);
  const maybeMore = useCallback(() => {
    const el = scroller.current;
    const f = useInbox.getState().feed;
    if (!el || f.key !== key || !f.loaded || !f.nextCursor || f.loading || f.error) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < MORE_THRESHOLD)
      void useInbox.getState().loadMentions(spaceRef.current, { more: true });
  }, [key]);
  // After every page (a short or empty page, or dismissals, may leave the box unfilled).
  useEffect(() => {
    maybeMore();
  }, [maybeMore, feed.items.length, feed.nextCursor, feed.loading, items.length]);

  const jump = (item: InboxMention) => {
    onClose();
    void jumpToMention(item, navigate);
  };

  const loadingFirst = !current || (!feed.loaded && feed.loading);
  return (
    <div ref={scroller} onScroll={maybeMore} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin" aria-busy={feed.loading || undefined}>
      {groups.length ? (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <MentionCard key={g.key} group={g} onJump={jump} />
          ))}
        </div>
      ) : null}
      {current && feed.error ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-[14px] text-danger">{feed.error}</p>
          <Button size="sm" variant="secondary" onClick={() => void useInbox.getState().loadMentions(spaceId, { more: feed.loaded && !!feed.nextCursor })}>
            Try again
          </Button>
        </div>
      ) : loadingFirst || (feed.loading && feed.nextCursor) || (feed.nextCursor && !groups.length) ? (
        <div className="flex justify-center py-6">
          <Spinner size={22} className="text-brand-ink" />
        </div>
      ) : !groups.length ? (
        <EmptyState
          icon={AtSign}
          title="You’re all caught up!"
          description={`Messages that mention you from the last ${INBOX_MENTION_DAYS} days show up here.`}
        />
      ) : null}
    </div>
  );
}
