/**
 * Announcement channels (Publish and Follow): who may publish a message, the message menu's
 * Publish item and the inline pill's action, and the follow calls. Publishing is final (no
 * unpublish), so both entry points confirm first; a just-published message shows a small
 * "Published" check for a moment (`usePublished`).
 */
import { Megaphone } from 'lucide-react';
import { create } from 'zustand';
import {
  MESSAGE_FLAGS,
  PERM,
  hasMessageFlag,
  hasPerm,
  type ChannelFollow,
  type ChatSummary,
  type ID,
  type Message,
} from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { api } from '@/lib/api';
import { getMyId } from '@/stores/auth';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { confirm, toast } from '@/stores/ui';

/** How long the "Published" check stays after publishing. */
export const PUBLISHED_HINT_MS = 4000;

/** A text channel converted to an announcement channel. */
export function isAnnouncementChannel(chat: Pick<ChatSummary, 'type' | 'space'>): boolean {
  return chat.type === 'space_text' && !!chat.space?.isNews;
}

/**
 * Whether `m` can be published: a confirmed, unpublished message of an announcement channel
 * (not a copy from a followed channel, a poll or a server message) — mine while I can send
 * there, or anyone's with MANAGE_MESSAGES. The server checks the same.
 */
export function canPublish(
  chat: Pick<ChatSummary, 'type' | 'space' | 'spacePermissions'>,
  m: ClientMessage,
  me: ID | null = getMyId(),
): boolean {
  if (!isAnnouncementChannel(chat)) return false;
  if (m.seq <= 0 || m.pending || m.failed || m.deletedAt) return false;
  if (m.type === 'system' || m.type === 'call' || m.type === 'poll') return false;
  if (
    hasMessageFlag(m.flags, MESSAGE_FLAGS.CROSSPOSTED) ||
    hasMessageFlag(m.flags, MESSAGE_FLAGS.IS_CROSSPOST)
  )
    return false;
  const bits = chat.spacePermissions;
  if (hasPerm(bits, PERM.MANAGE_MESSAGES)) return true;
  return !!me && m.senderId === me && hasPerm(bits, PERM.SEND_MESSAGES);
}

/** Messages published from this device a moment ago (the pill's "Published" check). */
export const usePublished = create<{ ids: Record<ID, true> }>(() => ({ ids: {} }));

function markPublished(id: ID): void {
  usePublished.setState((s) => ({ ids: { ...s.ids, [id]: true } }));
  setTimeout(
    () =>
      usePublished.setState((s) => {
        const { [id]: _, ...rest } = s.ids;
        return { ids: rest };
      }),
    PUBLISHED_HINT_MS,
  );
}

/** Confirm, then publish to every channel following this one. True once published. */
export async function publishMessage(chat: ChatSummary, m: ClientMessage): Promise<boolean> {
  const ok = await confirm({
    title: 'Publish Message',
    message: `This message will be sent to every channel following #${chat.name ?? 'this channel'}. Published messages can't be unpublished.`,
    confirmLabel: 'Publish',
  });
  if (!ok) return false;
  try {
    const message = await api.post<Message>(`/api/messages/${m.id}/crosspost`);
    useMessages.getState().upsertMessage(message, { onlyIfPresent: true });
    markPublished(m.id);
    toast.success('Published to every channel following this one');
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** Message menu ▸ Publish (announcement channels). */
export function publishMessageItem(chat: ChatSummary, m: ClientMessage): MenuEntry {
  if (!canPublish(chat, m)) return null;
  return { label: 'Publish', icon: Megaphone, onSelect: () => void publishMessage(chat, m) };
}

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

/** Deliver an announcement channel's published posts into `targetChannelId`. */
export function followChannel(sourceId: ID, targetChannelId: ID): Promise<ChannelFollow> {
  return api.post<ChannelFollow>(`/api/chats/${sourceId}/followers`, { targetChannelId });
}

/** The channels followed into a Space (MANAGE_WEBHOOKS there). */
export function listSpaceFollows(spaceId: ID): Promise<ChannelFollow[]> {
  return api.get<ChannelFollow[]>(`/api/spaces/${spaceId}/follows`);
}

/** Stop a follow (its follower webhook goes too). */
export function unfollowChannel(followId: ID): Promise<void> {
  return api.delete(`/api/channel-follows/${followId}`);
}
