/**
 * What a `#{id}` channel mention points at (everyday.ts `CHANNEL_MENTION_RE`): a channel of a
 * Space I can see, shown as "#name" with its type's icon (the sidebar's), and where it opens —
 * the channel, or the thread or forum post beside its parent. Anything else (unknown, gone,
 * not a Space channel) is "#unknown". Pure (unit-tested).
 */
import {
  Hash,
  Images,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Podcast,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { chatPath } from '@/features/chats/links';

type ChannelLike = Pick<ChatSummary, 'id' | 'type' | 'name' | 'space' | 'thread'>;

/** A channel's icon as the sidebar draws it (threads, posts and forums their own). */
export function channelIcon(chat: Pick<ChatSummary, 'type' | 'space' | 'thread'>): LucideIcon {
  switch (chat.type) {
    case 'space_voice':
      return Volume2;
    case 'space_stage':
      return Podcast;
    case 'space_forum':
      return chat.space?.forum?.settings.media ? Images : MessagesSquare;
    case 'space_thread':
      return MessagesSquare;
    default:
      return chat.space?.isNews ? Megaphone : Hash;
  }
}

export interface ChannelMentionTarget {
  name: string;
  icon: LucideIcon;
  /** In-app path: the channel, or `?thread=` on its parent for a thread or forum post. */
  path: string;
}

/** Where a mention of `chat` leads, or null for "#unknown". */
export function channelMentionTarget(
  chat: ChannelLike | undefined,
  parent?: Pick<ChatSummary, 'type'> | undefined,
): ChannelMentionTarget | null {
  if (!chat?.space || !chat.name) return null;
  const parentId = chat.type === 'space_thread' ? chat.thread?.parentId : undefined;
  const path = parentId
    ? `/spaces/${chat.space.spaceId}/${parentId}?thread=${chat.id}`
    : chatPath(chat);
  // A forum's posts wear the post icon.
  const icon = parent?.type === 'space_forum' ? MessageSquare : channelIcon(chat);
  return { name: chat.name, icon, path };
}
