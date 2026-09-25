/**
 * Message actions (REST mutations + optimistic store updates). UI entry points: the message
 * menu / long-press sheet, the selection bar and the bubbles themselves.
 */
import {
  MAX_PINNED_MESSAGES,
  canDeleteForEveryone,
  canEditMessage,
  renderMentions,
  type ChatSummary,
  type ID,
  type Message,
  type MessagePreview,
} from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { isLocalId } from '@/lib/ids';
import { getMyId } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { choose, confirm, toast } from '@/stores/ui';
import { mentionName } from '@/features/chats/preview';
import { applyReaction, applyVote, nextVoteSelection } from './lib/optimistic';
import { cancelUpload, retryMediaSend } from './lib/sendMedia';
import { useConversationUi } from './state';

export function isAnonymousChat(chat: Pick<ChatSummary, 'type'>): boolean {
  return chat.type === 'channel';
}

/** A quote of `m` for optimistic replies (the server computes the real one). */
export function previewOf(m: ClientMessage): MessagePreview {
  return {
    id: m.id,
    chatId: m.chatId,
    seq: m.seq,
    senderId: m.senderId,
    type: m.type,
    text: m.text ? m.text.slice(0, 200) : null,
    media: m.media
      ? {
          id: m.media.id,
          kind: m.media.kind,
          url: m.media.url,
          thumbnailUrl: m.media.thumbnailUrl,
          mimeType: m.media.mimeType,
          fileName: m.media.fileName,
          durationMs: m.media.durationMs,
        }
      : null,
    deleted: !!m.deletedAt,
  };
}

export function isActionable(m: ClientMessage): boolean {
  return !isLocalId(m.id) && !m.pending && !m.failed;
}

export function canReact(chat: ChatSummary, m: ClientMessage): boolean {
  if (!isActionable(m) || m.deletedAt || m.type === 'system') return false;
  if (chat.membership !== 'active') return false;
  if (chat.type === 'channel' && chat.channelSettings?.reactions === 'none') return false;
  return true;
}

/** Reply (menu, swipe): the server refuses replies to system and call messages. */
export function canReply(chat: ChatSummary, m: ClientMessage): boolean {
  return (
    isActionable(m) &&
    !m.deletedAt &&
    m.type !== 'system' &&
    m.type !== 'call' &&
    chat.permissions.canSend &&
    chat.membership === 'active'
  );
}

/** What we know about the sender of a group message, for the private actions below. */
export interface SenderInfo {
  /** The sender's account was deleted (cached profile). */
  deleted: boolean;
  /** Whether the sender is still an active member; null when the member list isn't loaded. */
  member: boolean | null;
}

function otherGroupSender(chat: ChatSummary, m: ClientMessage, meId: ID | null | undefined) {
  return chat.type === 'group' && !!m.senderId && m.senderId !== meId && isActionable(m);
}

/**
 * "Reply privately": the server accepts a private reply only while both the sender and I
 * are active members of the group (and the sender's account exists).
 */
export function canReplyPrivately(
  chat: ChatSummary,
  m: ClientMessage,
  meId: ID | null | undefined,
  sender: SenderInfo,
): boolean {
  return (
    otherGroupSender(chat, m, meId) &&
    !m.deletedAt &&
    chat.membership === 'active' &&
    !sender.deleted &&
    sender.member !== false
  );
}

/** "Message X": opening a direct chat with a deleted account fails. */
export function canMessageSender(
  chat: ChatSummary,
  m: ClientMessage,
  meId: ID | null | undefined,
  sender: SenderInfo,
): boolean {
  return otherGroupSender(chat, m, meId) && !sender.deleted;
}

export function canForward(m: ClientMessage): boolean {
  return isActionable(m) && !m.deletedAt && m.type !== 'system' && m.type !== 'call';
}

export function canPinMessage(chat: ChatSummary, m: ClientMessage): boolean {
  return (
    chat.permissions.canPin &&
    chat.membership === 'active' &&
    isActionable(m) &&
    !m.deletedAt &&
    m.type !== 'system' &&
    m.type !== 'call'
  );
}

export function canEdit(chat: ChatSummary, m: ClientMessage): boolean {
  const me = getMyId();
  return !!me && isActionable(m) && canEditMessage(m, chat, me);
}

export function canInfo(chat: ChatSummary, m: ClientMessage): boolean {
  const me = getMyId();
  return (
    chat.type !== 'channel' &&
    isActionable(m) &&
    m.senderId === me &&
    m.type !== 'system' &&
    m.type !== 'call' &&
    !m.deletedAt
  );
}

export function copyText(m: ClientMessage): string | null {
  if (m.deletedAt || !m.text) return null;
  return renderMentions(m.text, mentionName);
}

export async function copyMessages(messages: ClientMessage[]): Promise<void> {
  const parts = messages.map(copyText).filter((t): t is string => !!t);
  if (!parts.length) return;
  try {
    await navigator.clipboard.writeText(parts.join('\n'));
    toast.success(parts.length > 1 ? `${parts.length} messages copied` : 'Message copied', {
      id: 'copied',
    });
  } catch {
    toast.error("Couldn't copy to the clipboard");
  }
}

export async function react(
  chat: ChatSummary,
  m: ClientMessage,
  emoji: string | null,
): Promise<void> {
  const me = getMyId();
  if (!me || !canReact(chat, m)) return;
  const store = useMessages.getState();
  const before = { reactions: m.reactions, myReaction: m.myReaction };
  const next = applyReaction(m, emoji, me, isAnonymousChat(chat));
  store.patchMessage(m.chatId, m.id, { reactions: next.reactions, myReaction: next.myReaction });
  try {
    const updated = emoji
      ? await api.put<Message>(`/api/messages/${m.id}/reaction`, { emoji })
      : await api.delete<Message>(`/api/messages/${m.id}/reaction`);
    if (updated) useMessages.getState().upsertMessage(updated, { onlyIfPresent: true });
  } catch (e) {
    useMessages.getState().patchMessage(m.chatId, m.id, before);
    toast.error(e);
  }
}

export async function vote(chat: ChatSummary, m: ClientMessage, optionId: string): Promise<void> {
  const me = getMyId();
  if (!me || !m.poll || !isActionable(m) || chat.membership !== 'active') return;
  const optionIds = nextVoteSelection(m.poll, optionId, me);
  const before = m.poll;
  useMessages.getState().patchMessage(m.chatId, m.id, {
    poll: applyVote(m.poll, optionIds, me, isAnonymousChat(chat)),
  });
  try {
    const updated = await api.put<Message>(`/api/messages/${m.id}/vote`, { optionIds });
    useMessages.getState().upsertMessage(updated, { onlyIfPresent: true });
  } catch (e) {
    useMessages.getState().patchMessage(m.chatId, m.id, { poll: before });
    toast.error(e);
  }
}

export async function setStarred(messages: ClientMessage[], starred: boolean): Promise<void> {
  const list = messages.filter((m) => isActionable(m) && !m.deletedAt && !!m.starred !== starred);
  if (!list.length) return;
  const store = useMessages.getState();
  for (const m of list) store.patchMessage(m.chatId, m.id, { starred });
  const results = await Promise.allSettled(
    list.map((m) =>
      starred ? api.put(`/api/messages/${m.id}/star`) : api.delete(`/api/messages/${m.id}/star`),
    ),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected')
      useMessages.getState().patchMessage(list[i]!.chatId, list[i]!.id, { starred: !starred });
  });
  const failed = results.find((r) => r.status === 'rejected');
  if (failed && failed.status === 'rejected') toast.error(failed.reason);
}

export async function pinMessage(chat: ChatSummary, m: ClientMessage): Promise<void> {
  const pins = useChats.getState().pins[chat.id] ?? [];
  if (pins.length >= MAX_PINNED_MESSAGES) {
    const ok = await confirm({
      title: 'Replace oldest pin?',
      message: `You can pin up to ${MAX_PINNED_MESSAGES} messages. Your new pin will replace the oldest one.`,
      confirmLabel: 'Continue',
    });
    if (!ok) return;
  }
  try {
    const list = await api.post<Message[]>(`/api/chats/${chat.id}/pins`, { messageId: m.id });
    useChats.getState().setPins(
      chat.id,
      list.map((x) => x.id),
    );
    toast.success('Message pinned', { id: 'pin' });
  } catch (e) {
    toast.error(e);
  }
}

export async function unpinMessage(chat: ChatSummary, messageId: ID): Promise<void> {
  try {
    const list = await api.delete<Message[]>(`/api/chats/${chat.id}/pins/${messageId}`);
    useChats.getState().setPins(
      chat.id,
      (list ?? []).map((x) => x.id),
    );
  } catch (e) {
    toast.error(e);
  }
}

/** Delete one or more messages with the WhatsApp choice dialog. Returns true when done. */
export async function deleteMessages(
  chat: ChatSummary,
  messages: ClientMessage[],
): Promise<boolean> {
  const me = getMyId();
  if (!me || !messages.length) return false;
  const local = messages.filter((m) => isLocalId(m.id));
  const remote = messages.filter((m) => !isLocalId(m.id));
  const everyoneOk = remote.length > 0 && remote.every((m) => canDeleteForEveryone(m, chat, me));
  const n = messages.length;
  const title = n > 1 ? `Delete ${n} messages?` : 'Delete message?';
  let mode: 'me' | 'everyone' | null;
  if (everyoneOk) {
    mode = await choose<'me' | 'everyone'>({
      title,
      options: [
        { value: 'everyone', label: 'Delete for everyone', danger: true },
        { value: 'me', label: 'Delete for me', danger: true },
      ],
    });
  } else {
    mode = (await confirm({
      title,
      message: remote.length
        ? 'They will be removed from this device and your other devices.'
        : undefined,
      confirmLabel: 'Delete for me',
      danger: true,
    }))
      ? 'me'
      : null;
  }
  if (!mode) return false;

  const store = useMessages.getState();
  for (const m of local) {
    if (m.clientId) {
      cancelUpload(m.clientId);
      store.removeOptimistic(chat.id, m.clientId);
    }
  }
  if (mode === 'me')
    store.removeMessages(
      chat.id,
      remote.map((m) => m.id),
    );
  else {
    for (const m of remote)
      store.patchMessage(chat.id, m.id, {
        deletedAt: new Date().toISOString(),
        text: null,
        media: null,
        reactions: [],
        poll: null,
        location: null,
        contact: null,
      });
  }
  const results = await Promise.allSettled(
    remote.map((m) => api.delete(`/api/messages/${m.id}`, undefined, { query: { for: mode } })),
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    toast.error((failed[0] as PromiseRejectedResult).reason);
    // Resync the window: the local removal/tombstone may be wrong.
    void useMessages
      .getState()
      .loadLatest(chat.id)
      .catch(() => undefined);
  }
  if (
    mode === 'me' &&
    useChats.getState().byId[chat.id]?.lastMessage &&
    remote.some((m) => m.id === useChats.getState().byId[chat.id]?.lastMessage?.id)
  )
    void useChats
      .getState()
      .refreshChat(chat.id)
      .catch(() => undefined);
  return true;
}

export async function saveEdit(
  chat: ChatSummary,
  m: ClientMessage,
  text: string,
): Promise<boolean> {
  const trimmed = text.trim();
  if (m.type === 'text' && !trimmed) {
    toast.error("A message can't be empty");
    return false;
  }
  if ((m.text ?? '') === trimmed) return true;
  const before = { text: m.text, editedAt: m.editedAt };
  useMessages
    .getState()
    .patchMessage(chat.id, m.id, { text: trimmed || null, editedAt: new Date().toISOString() });
  try {
    const updated = await api.patch<Message>(`/api/messages/${m.id}`, { text: trimmed });
    useMessages.getState().upsertMessage(updated, { onlyIfPresent: true });
    return true;
  } catch (e) {
    useMessages.getState().patchMessage(chat.id, m.id, before);
    toast.error(
      e instanceof ApiError && e.code === 'expired' ? 'This message can no longer be edited' : e,
    );
    return false;
  }
}

export function retry(chatId: ID, m: ClientMessage): void {
  if (!m.clientId) return;
  if (retryMediaSend(m.clientId)) return;
  void useMessages
    .getState()
    .retryMessage(chatId, m.clientId)
    .then((r) => {
      if (r === null) toast.error("This message can't be retried. Delete it and send again.");
    })
    .catch((e: unknown) => toast.error(e));
}

export function startReply(chat: ChatSummary, m: ClientMessage): void {
  useConversationUi.getState().setReply(chat.id, m);
}

export function startEdit(chat: ChatSummary, m: ClientMessage): void {
  useConversationUi.getState().setEditing(chat.id, m);
}

/** Open (or create) the direct chat with a user; returns its id. */
export async function openDirectChat(userId: ID): Promise<ID | null> {
  try {
    const chat = await api.post<ChatSummary>('/api/chats/direct', { userId });
    useChats.getState().upsertChat(chat);
    return chat.id;
  } catch (e) {
    toast.error(e);
    return null;
  }
}

/** Selected messages of a chat, in list order. */
export function selectedMessages(chatId: ID): ClientMessage[] {
  const ids = new Set(useConversationUi.getState().selecting[chatId] ?? []);
  return (useMessages.getState().byChat[chatId]?.items ?? []).filter((m) => ids.has(m.id));
}
