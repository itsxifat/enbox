/**
 * Test factories for wire models. Use in unit tests (and Playwright mocks) to build
 * realistic objects with sensible defaults: `makeChat({ unreadCount: 3 })`.
 */
import {
  DEFAULT_USER_SETTINGS,
  computeChatPermissions,
  type ChatSummary,
  type Message,
  type UserPublic,
  type UserSelf,
} from '@enbox/shared';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function makeUser(p: Partial<UserPublic> = {}): UserPublic {
  const id = p.id ?? uuid();
  return {
    id,
    username: `user${id.slice(-4)}`,
    displayName: 'Test User',
    avatarUrl: null,
    about: null,
    phone: null,
    online: null,
    lastSeenAt: null,
    isContact: false,
    contactName: null,
    isBlocked: false,
    isDeleted: false,
    ...p,
  };
}

export function makeMe(p: Partial<UserSelf> = {}): UserSelf {
  return {
    id: uuid(),
    username: 'me',
    displayName: 'Me',
    avatarUrl: null,
    about: 'Hey there! I am using Enbox.',
    phone: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    settings: { ...DEFAULT_USER_SETTINGS },
    ...p,
  };
}

export function makeMessage(p: Partial<Message> = {}): Message {
  return {
    id: p.id ?? uuid(),
    chatId: 'chat-1',
    seq: 1,
    clientId: null,
    senderId: 'user-1',
    type: 'text',
    text: 'hello',
    media: null,
    location: null,
    contact: null,
    poll: null,
    system: null,
    call: null,
    statusReply: null,
    replyTo: null,
    forwardCount: 0,
    mentions: [],
    reactions: [],
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    createdAt: '2025-03-12T10:42:00.000Z',
    ...p,
  };
}

/** A chat as seen by user 'me'; `permissions` are computed from the other fields unless given. */
export function makeChat(p: Partial<ChatSummary> = {}): ChatSummary {
  const chat: Omit<ChatSummary, 'permissions'> & { permissions?: ChatSummary['permissions'] } = {
    id: p.id ?? uuid(),
    type: 'group',
    name: 'Test chat',
    description: null,
    avatarUrl: null,
    peer: null,
    communityId: null,
    isAnnouncement: false,
    memberCount: 2,
    groupSettings: null,
    channelSettings: null,
    myRole: 'member',
    membership: 'active',
    inviteCode: null,
    disappearingSeconds: null,
    lastMessage: null,
    lastSeq: 0,
    lastReadSeq: 0,
    unreadCount: 0,
    unreadMentionCount: 0,
    readWatermark: 0,
    deliveredWatermark: 0,
    isPinned: false,
    isArchived: false,
    mutedUntil: null,
    markedUnread: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    lastActivityAt: '2025-01-01T00:00:00.000Z',
    ...p,
  };
  return { ...chat, permissions: chat.permissions ?? computeChatPermissions(chat, 'me') };
}
