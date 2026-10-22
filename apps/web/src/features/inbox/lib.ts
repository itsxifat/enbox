/**
 * Inbox logic (pure, unit-tested): the button's mention count, the Unreads tab's groups, the
 * Mentions tab's channel groups, where a mention jumps to, and its timestamp.
 */
import type { NavigateFunction } from 'react-router';
import {
  isMuted,
  type ChatSummary,
  type ID,
  type InboxMention,
  type Space,
} from '@enbox/shared';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { chatPath } from '@/features/chats/links';
import { formatShortDate, formatTime, isSameLocalDay } from '@/lib/format';
import { getChat, isChatUnread, useChats } from '@/stores/chats';
import { useSidePanel } from '@/stores/sidePanel';
import { isSpaceMuted } from '@/stores/spaces';

/** How far back the Mentions tab looks (the server's window). */
export const INBOX_MENTION_DAYS = 30;

/** The Space of the current route (`/spaces/:spaceId/…`), if any. */
export function spaceIdOfPath(pathname: string): ID | null {
  return /^\/spaces\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * Unread mentions of me for the Inbox button: the chats store's `unreadMentionCount` over the
 * Space channels (and threads) of Spaces whose channels are loaded and over my groups, plus the
 * server's aggregate for the Spaces not loaded yet. DMs are not mentions (they have Unreads).
 */
export function inboxMentionCount(
  chats: Readonly<Record<ID, ChatSummary>>,
  spaces: Readonly<Record<ID, Space>>,
  channelsLoaded: Readonly<Record<ID, boolean>>,
): number {
  let n = 0;
  for (const c of Object.values(chats)) {
    if (c.space) {
      if (channelsLoaded[c.space.spaceId] && spaces[c.space.spaceId]) n += c.unreadMentionCount;
    } else if (c.type === 'group' && c.membership === 'active') n += c.unreadMentionCount;
  }
  for (const s of Object.values(spaces)) if (!channelsLoaded[s.id]) n += s.unreadMentionCount;
  return n;
}

/** One block of the Unreads tab: a Space's channels, or the DMs and groups. */
export interface UnreadGroup {
  key: string;
  /** null: Direct Messages. */
  space: Space | null;
  chats: ChatSummary[];
}

const activity = (c: ChatSummary) => Date.parse(c.lastActivityAt) || 0;

/**
 * Unread chats that are not muted: Space text channels and threads (not in muted Spaces) by
 * Space, then DMs and groups (not archived). Newest activity first, in groups and inside them.
 */
export function unreadGroups(
  chats: Readonly<Record<ID, ChatSummary>>,
  spaces: Readonly<Record<ID, Space>>,
  now = new Date(),
): UnreadGroup[] {
  const bySpace = new Map<ID, ChatSummary[]>();
  const direct: ChatSummary[] = [];
  for (const c of Object.values(chats)) {
    if (!isChatUnread(c) || isMuted(c.mutedUntil, now)) continue;
    if (c.space) {
      if (c.type !== 'space_text' && c.type !== 'space_thread') continue;
      const space = spaces[c.space.spaceId];
      if (!space || isSpaceMuted(space, now.getTime())) continue;
      const list = bySpace.get(space.id);
      if (list) list.push(c);
      else bySpace.set(space.id, [c]);
    } else if ((c.type === 'direct' || c.type === 'group') && !c.isArchived && c.membership === 'active') {
      direct.push(c);
    }
  }
  const byActivity = (a: ChatSummary, b: ChatSummary) => activity(b) - activity(a) || (a.id < b.id ? -1 : 1);
  const out: UnreadGroup[] = [];
  if (direct.length) out.push({ key: 'direct', space: null, chats: direct.sort(byActivity) });
  for (const [spaceId, list] of bySpace)
    out.push({ key: spaceId, space: spaces[spaceId]!, chats: list.sort(byActivity) });
  const newest = (g: UnreadGroup) => activity(g.chats[0]!);
  return out.sort((a, b) => newest(b) - newest(a) || (a.key < b.key ? -1 : 1));
}

/** Consecutive mentions of the same chat share one card (Discord's "#channel · Server" header). */
export interface MentionGroup {
  key: string;
  chat: InboxMention['chat'];
  items: InboxMention[];
}

export function groupMentions(items: readonly InboxMention[]): MentionGroup[] {
  const out: MentionGroup[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.chat.id === item.chat.id) last.items.push(item);
    else out.push({ key: item.message.id, chat: item.chat, items: [item] });
  }
  return out;
}

/** The route of a mention: its channel (or group) scrolled to the message (`?m=&mid=`). */
export function mentionPath(item: InboxMention): string {
  const { chat, message } = item;
  const space = chat.spaceId ? ({ spaceId: chat.spaceId } as ChatSummary['space']) : null;
  return chatPath({ id: chat.id, type: chat.type, space }, { seq: message.seq, messageId: message.id });
}

/**
 * Open a mention. A thread opens beside its parent channel (the side panel); its parent comes
 * from the thread's summary (cached, else fetched). Everything else opens at the message.
 */
export async function jumpToMention(item: InboxMention, navigate: NavigateFunction): Promise<void> {
  const { chat } = item;
  if (chat.type === 'space_thread' && chat.spaceId) {
    const summary =
      getChat(chat.id) ??
      (await useChats
        .getState()
        .refreshChat(chat.id)
        .catch(() => null));
    const parentId = summary?.thread?.parentId;
    if (parentId) {
      void navigate(`/spaces/${chat.spaceId}/${parentId}`, { state: IN_APP_NAV });
      // After the channel route rendered (it may reset the panel on a channel change).
      setTimeout(() => useSidePanel.getState().open({ kind: 'thread', threadId: chat.id, parentId }), 0);
      return;
    }
  }
  void navigate(mentionPath(item), { state: IN_APP_NAV });
}

/** Open a chat of the Unreads tab (a thread: beside its parent channel). */
export function openUnreadChat(chat: ChatSummary, navigate: NavigateFunction): void {
  const parentId = chat.type === 'space_thread' ? chat.thread?.parentId : undefined;
  if (parentId && chat.space) {
    void navigate(`/spaces/${chat.space.spaceId}/${parentId}`, { state: IN_APP_NAV });
    setTimeout(() => useSidePanel.getState().open({ kind: 'thread', threadId: chat.id, parentId }), 0);
    return;
  }
  void navigate(chatPath(chat), { state: IN_APP_NAV });
}

/** "Today at 9:42", "Yesterday at 9:42", else "12/03/2026 9:42" (Discord's message times). */
export function formatInboxTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(d, now)) return `Today at ${formatTime(d)}`;
  if (isSameLocalDay(d, yesterday)) return `Yesterday at ${formatTime(d)}`;
  return `${formatShortDate(d)} ${formatTime(d)}`;
}
