/**
 * In-app message banners: while Enbox is open and visible, a new message in another chat that
 * would notify me shows a small card at the top right (MessageBanners): at most MAX_BANNERS,
 * newest on top, one per chat, each hiding after BANNER_MS. Off with Settings ▸ Notifications
 * ▸ In-app banners, in do not disturb and with Streamer Mode's Disable Notifications. While
 * the window is not focused and desktop notifications can show, those take over instead.
 * realtime/bookmarks.ts offers every `message:new` (after the messages handler ran).
 */
import { create } from 'zustand';
import {
  MESSAGE_FLAGS,
  chatKindOf,
  chatTitle,
  hasMessageFlag,
  isDnd,
  isMuted,
  isSpaceChatType,
  isVoiceChannelType,
  truncate,
  userDisplayName,
  type ChatSummary,
  type ID,
  type Message,
  type UserSelf,
} from '@enbox/shared';
import { useChatMembersStore } from '@/features/conversation/members';
import { UNNAMED_GROUP_DM, groupDmMemberNames, isUnnamedGroupDm } from '@/features/groupDms/title';
import { isAppFocused, notificationPermission } from '@/lib/notify';
import { registerSessionReset } from '@/lib/session';
import { notificationBody } from '@/realtime/messages';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { isIgnored } from '@/stores/ignores';
import { useSidePanel } from '@/stores/sidePanel';
import { mentionsMe, notifyLevelOf, useSpaces } from '@/stores/spaces';
import { streamerHides } from '@/stores/streamer';
import { useUi } from '@/stores/ui';
import { nameOf, useUsers } from '@/stores/users';

export const MAX_BANNERS = 3;
export const BANNER_MS = 6_000;
const TEXT_MAX = 140;

export interface MessageBanner {
  /** One banner per chat. */
  chatId: ID;
  message: Message;
  /** The sender as the chat shows them (a Space nickname first). */
  name: string;
  /** "#general · Gaming", a group's name; null in a DM. */
  where: string | null;
  /** The first line, mentions resolved ("New message" without previews). */
  text: string;
  avatarUrl: string | null;
  /** Fallback colour of the avatar. */
  avatarSeed: string;
}

/**
 * Whether a new message would notify me, by the rules of desktop notifications: not mine, not
 * a system or call message, not @silent, not a broadcast channel, a muted chat or Space or
 * someone I ignore; in Spaces the notification level decides (a thread I follow: all of it,
 * unless the thread itself says otherwise; a muted channel mutes its threads); then my message
 * or group switch, and never in do not disturb.
 */
export function wouldNotify(
  message: Message,
  chat: ChatSummary,
  me: UserSelf,
  now = new Date(),
): boolean {
  if (message.senderId === me.id || message.type === 'system' || message.type === 'call')
    return false;
  if (hasMessageFlag(message.flags, MESSAGE_FLAGS.SILENT)) return false;
  if (chat.type === 'channel' || isMuted(chat.mutedUntil, now)) return false;
  if (isIgnored(message.senderId)) return false;
  if (isSpaceChatType(chat.type)) {
    const space = chat.space ? useSpaces.getState().byId[chat.space.spaceId] : undefined;
    if (space && isMuted(space.me.mutedUntil, now)) return false;
    const parentId = chat.type === 'space_thread' ? chat.thread?.parentId : undefined;
    const parent = parentId ? useChats.getState().byId[parentId] : undefined;
    if (parent && isMuted(parent.mutedUntil, now)) return false;
    const level =
      chat.notifyLevel ?? (chat.thread?.following ? 'all' : notifyLevelOf(parent ?? chat));
    if (level === 'none' || (level === 'mentions' && !mentionsMe(message, chat, me.id)))
      return false;
  }
  const s = me.settings;
  if (chat.type === 'direct' ? !s.messageNotifications : !s.groupNotifications) return false;
  return !isDnd(me, now.getTime());
}

/** The card of a message: who, where and its first line, from the caches. */
export function describeBanner(message: Message, chat: ChatSummary, me: UserSelf): MessageBanner {
  const spaceId = chat.space?.spaceId;
  const spaces = useSpaces.getState();
  const space = spaceId ? spaces.byId[spaceId] : undefined;
  const members = spaceId ? spaces.members[spaceId] : undefined;
  const senderId = message.senderId;
  const user = senderId
    ? (useUsers.getState().byId[senderId] ?? (chat.peer?.id === senderId ? chat.peer : undefined))
    : undefined;
  const member = senderId ? members?.[senderId] : undefined;
  const name =
    member?.nickname ||
    (user
      ? userDisplayName(user)
      : (message.authorOverride?.name ?? (senderId ? nameOf(senderId) : chatTitle(chat))));
  const where = isSpaceChatType(chat.type)
    ? [`${isVoiceChannelType(chat.type) ? '🔊 ' : '#'}${chat.name ?? ''}`, space?.name]
        .filter(Boolean)
        .join(' · ')
    : chat.type === 'direct'
      ? null
      : isUnnamedGroupDm(chat)
        ? (groupDmMemberNames(
            useChatMembersStore.getState().byChat[chat.id],
            me.id,
            useUsers.getState().byId,
          ) ?? UNNAMED_GROUP_DM)
        : chatTitle(chat);
  const body = me.settings.notificationPreviews
    ? notificationBody(
        message,
        {
          nameOf: (id) => members?.[id]?.nickname || nameOf(id, { you: me.displayName }),
          roleName: (id) => space?.roles.find((r) => r.id === id)?.name ?? 'role',
        },
        { viewerId: me.id, chatKind: chatKindOf(chat) },
      )
    : 'New message';
  const firstLine = body.split('\n').find((l) => l.trim()) ?? body;
  return {
    chatId: chat.id,
    message,
    name,
    where,
    text: truncate(firstLine.trim(), TEXT_MAX),
    avatarUrl: member?.avatarUrl ?? user?.avatarUrl ?? message.authorOverride?.avatarUrl ?? null,
    avatarSeed: senderId ?? chat.id,
  };
}

/** The chat is on screen: open, or the thread panel beside it. */
function onScreen(chatId: ID): boolean {
  if (useChats.getState().openChatId === chatId) return true;
  const panel = useSidePanel.getState().panel;
  return panel?.kind === 'thread' && panel.threadId === chatId;
}

/** The banner a new message gets now, or null (see the header). */
export function bannerFor(message: Message): MessageBanner | null {
  const me = useAuth.getState().user;
  const chat = useChats.getState().byId[message.chatId];
  const { prefs } = useUi.getState();
  if (!me || !chat || !prefs.inAppBanners || streamerHides('notifications')) return null;
  if (document.visibilityState !== 'visible' || onScreen(chat.id)) return null;
  // In the background the desktop notification shows it (realtime/messages.ts).
  if (!isAppFocused() && prefs.desktopNotifications && notificationPermission() === 'granted')
    return null;
  return wouldNotify(message, chat, me) ? describeBanner(message, chat, me) : null;
}

interface BannersState {
  banners: MessageBanner[];
}

export const useBanners = create<BannersState>(() => ({ banners: [] }));

export function showBanner(banner: MessageBanner): void {
  useBanners.setState((s) => ({
    banners: [banner, ...s.banners.filter((b) => b.chatId !== banner.chatId)].slice(0, MAX_BANNERS),
  }));
}

export function dismissBanner(chatId: ID): void {
  if (useBanners.getState().banners.some((b) => b.chatId === chatId))
    useBanners.setState((s) => ({ banners: s.banners.filter((b) => b.chatId !== chatId) }));
}

/** A new message arrived (realtime/bookmarks.ts). */
export function offerMessageBanner(message: Message): void {
  const banner = bannerFor(message);
  if (banner) showBanner(banner);
}

registerSessionReset(() => useBanners.setState({ banners: [] }));
