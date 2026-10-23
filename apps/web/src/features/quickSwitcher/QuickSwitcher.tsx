/**
 * Quick Switcher (Ctrl/Cmd+K): a search box over DMs, groups, Space channels, Spaces and
 * contacts. Up/Down move, Enter jumps, Esc closes. Opening it also loads the channel lists of
 * Spaces not opened yet this session (a few at a time), so their channels become searchable.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Hash, Volume2 } from 'lucide-react';
import { isVoiceChannelType, chatTitle, type ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Avatar, Portal, toast, useFocusTrap, useOverlay } from '@/components/ui';
import { openDirectChat } from '@/features/contacts/contactActions';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useContactList } from '@/stores/contacts';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { useSpaces } from '@/stores/spaces';
import { readRecents, recordVisit } from './recents';
import { rankItems, type SwitcherItem } from './search';

/** Spaces whose channels a single opening fetches in the background. */
const PRELOAD_SPACES = 20;

function isMuted(chat: ChatSummary): boolean {
  return !!chat.mutedUntil && Date.parse(chat.mutedUntil) > Date.now();
}

/** Everything the switcher can jump to, from the stores. */
function useSwitcherItems(): SwitcherItem[] {
  const me = useAuth((s) => s.user?.id);
  const chats = useChats((s) => s.byId);
  const spaces = useSpaces((s) => s.byId);
  const { items: contacts } = useContactList();
  return useMemo(() => {
    const out: SwitcherItem[] = [];
    const dmPeers = new Set<string>();
    for (const chat of Object.values(chats)) {
      const unread = chat.unreadCount > 0 && !isMuted(chat);
      if (chat.space) {
        const space = spaces[chat.space.spaceId];
        out.push({
          key: `chat:${chat.id}`,
          kind: isVoiceChannelType(chat.type) ? 'voice' : 'text',
          title: chat.name ?? 'channel',
          subtitle: space?.name ?? null,
          path: `/spaces/${chat.space.spaceId}/${chat.id}`,
          chatId: chat.id,
          spaceId: chat.space.spaceId,
          unread: !isVoiceChannelType(chat.type) && unread,
          mentions: chat.unreadMentionCount,
        });
        continue;
      }
      if (chat.type === 'direct' && chat.peer) dmPeers.add(chat.peer.id);
      out.push({
        key: `chat:${chat.id}`,
        kind: chat.type === 'direct' ? 'dm' : 'group',
        title: chatTitle(chat, me),
        subtitle: chat.type === 'direct' && chat.peer ? `@${chat.peer.username}` : null,
        path: chat.type === 'channel' ? `/updates/channels/${chat.id}` : `/chats/${chat.id}`,
        chatId: chat.id,
        userId: chat.type === 'direct' ? chat.peer?.id : undefined,
        unread,
        mentions: chat.unreadMentionCount,
      });
    }
    for (const space of Object.values(spaces))
      out.push({
        key: `space:${space.id}`,
        kind: 'space',
        title: space.name,
        subtitle: null,
        path: `/spaces/${space.id}`,
        spaceId: space.id,
        unread: false,
        mentions: 0,
      });
    for (const { user, name } of contacts)
      if (!dmPeers.has(user.id))
        out.push({
          key: `user:${user.id}`,
          kind: 'user',
          title: name || user.displayName,
          subtitle: `@${user.username}`,
          path: null,
          userId: user.id,
          unread: false,
          mentions: 0,
        });
    return out;
  }, [chats, spaces, contacts, me]);
}

function ItemIcon({ item }: { item: SwitcherItem }) {
  const space = useSpaces((s) => (item.kind === 'space' && item.spaceId ? s.byId[item.spaceId] : undefined));
  const chat = useChats((s) => (item.kind === 'group' && item.chatId ? s.byId[item.chatId] : undefined));
  if (item.kind === 'text') return <Hash size={18} className="text-subtle" aria-hidden />;
  if (item.kind === 'voice') return <Volume2 size={18} className="text-subtle" aria-hidden />;
  if (item.kind === 'space')
    return <Avatar src={space?.iconUrl} name={item.title} colorSeed={item.spaceId} kind="community" size={20} />;
  if (item.kind === 'group')
    return <Avatar src={chat?.avatarUrl} name={item.title} colorSeed={item.chatId} kind="group" size={20} />;
  return <UserAvatar userId={item.userId} size={20} decorated={false} />;
}

export function QuickSwitcher() {
  const open = useQuickSwitcher((s) => s.open);
  if (!open) return null;
  return <SwitcherDialog />;
}

function SwitcherDialog() {
  const hide = useQuickSwitcher((s) => s.hide);
  const initialQuery = useQuickSwitcher((s) => s.initialQuery);
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [recents] = useState(readRecents);
  const items = useSwitcherItems();
  const results = useMemo(() => rankItems(items, query, recents), [items, query, recents]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  useOverlay(true, hide, rootRef);
  useFocusTrap(panelRef, true, inputRef);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    const { byId, channelsLoaded, loadSpace } = useSpaces.getState();
    const pending = Object.keys(byId)
      .filter((id) => !channelsLoaded[id])
      .slice(0, PRELOAD_SPACES);
    void (async () => {
      for (const id of pending) await loadSpace(id).catch(() => undefined);
    })();
  }, []);

  const go = async (item: SwitcherItem | undefined) => {
    if (!item) return;
    hide();
    recordVisit(item.key);
    if (item.path) {
      void navigate(item.path);
      return;
    }
    if (!item.userId) return;
    try {
      const chat = await openDirectChat(item.userId);
      recordVisit(`chat:${chat.id}`);
      void navigate(`/chats/${chat.id}`);
    } catch {
      toast.error('Couldn’t open that conversation');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void go(results[active]);
    }
  };

  const activeId = results[active] ? `${listId}-${active}` : undefined;
  return (
    <Portal>
      <div ref={rootRef} className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
        <div className="absolute inset-0 animate-fade-in bg-overlay" aria-hidden onMouseDown={hide} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Quick switcher"
          className="relative flex max-h-[70vh] w-full max-w-[570px] animate-scale-in flex-col overflow-hidden rounded-2xl bg-elevated p-4 text-fg shadow-elevated"
          data-testid="quick-switcher"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Where would you like to go?"
            aria-label="Where would you like to go?"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            className="h-[70px] w-full shrink-0 rounded-lg bg-app px-4 text-[22px] text-fg outline-none placeholder:text-subtle"
          />
          {results.length ? (
            <>
              {!query.trim() ? (
                <p className="section-label mt-4 mb-1 px-2">{recents.length ? 'Previous channels' : 'Unread'}</p>
              ) : (
                <div className="mt-3" />
              )}
              <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                {results.map((item, i) => (
                  <li
                    key={item.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => void go(item)}
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[15px]',
                      i === active ? 'bg-hover text-fg' : 'text-muted',
                    )}
                    data-testid="switcher-result"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      <ItemIcon item={item} />
                    </span>
                    <span className={cn('min-w-0 truncate', (item.unread || item.mentions > 0) && 'font-semibold text-fg')}>
                      {item.title}
                    </span>
                    {item.subtitle ? <span className="min-w-0 truncate text-[13px] text-subtle">{item.subtitle}</span> : null}
                    <span className="flex-1" />
                    {item.mentions > 0 ? (
                      <span className="rounded-full bg-danger px-1.5 text-[12px] leading-[18px] font-bold text-white" aria-label={`${item.mentions} mentions`}>
                        {item.mentions}
                      </span>
                    ) : item.unread ? (
                      <span className="size-2 rounded-full bg-fg" aria-label="Unread" />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-6 mb-4 text-center text-[14px] text-muted">
              {query.trim() ? 'Can’t find what you’re looking for?' : 'Start typing to search'}
            </p>
          )}
          <p className="mt-3 shrink-0 text-[12px] text-subtle">
            <span className="font-bold text-success">PROTIP:</span> Start searches with <kbd className="font-semibold">@</kbd> for people,{' '}
            <kbd className="font-semibold">#</kbd> text channels, <kbd className="font-semibold">!</kbd> voice channels, <kbd className="font-semibold">*</kbd> servers.
          </p>
        </div>
      </div>
    </Portal>
  );
}
