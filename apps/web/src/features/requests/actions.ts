/**
 * Message request actions, shared by the Message Requests page and the banner over an open
 * request: Accept, Ignore, Block (the usual confirm) and Report (features/safety/report).
 * Replying also accepts: the server answers with the events of an accept.
 */
import { useEffect } from 'react';
import { userDisplayName, type ChatSummary, type ID } from '@enbox/shared';
import { confirmBlock } from '@/features/contacts/contactActions';
import { useProfiles } from '@/features/profile/profileStore';
import { openReport } from '@/features/safety/report';
import { api } from '@/lib/api';
import { markChatRead } from '@/realtime/chats';
import { useChats } from '@/stores/chats';
import { useRequests } from '@/stores/requests';
import { toast } from '@/stores/ui';

/** POST …/request/accept: the chat joins my list (and is read when it is the open one). */
export async function acceptRequest(chat: ChatSummary): Promise<boolean> {
  try {
    const accepted = await api.post<ChatSummary>(`/api/chats/${chat.id}/request/accept`);
    // Into the list first, so an open conversation never loses its chat in between.
    useChats.getState().upsertChat(accepted);
    useRequests.getState().remove(chat.id);
    if (useChats.getState().openChatId === chat.id) markChatRead(chat.id, { force: true });
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** POST …/request/ignore: it moves to Ignored at once (back on failure); they aren't told. */
export async function ignoreRequest(chat: ChatSummary): Promise<boolean> {
  const before = chat.request;
  useRequests.getState().markIgnored(chat.id);
  try {
    await api.post(`/api/chats/${chat.id}/request/ignore`);
    return true;
  } catch (e) {
    const current = useRequests.getState().byId[chat.id];
    if (current && before) useRequests.getState().upsert({ ...current, request: before });
    toast.error(e);
    return false;
  }
}

/** Block them (after the usual confirm); a pending request moves to Ignored with it. */
export async function blockRequester(chat: ChatSummary): Promise<boolean> {
  if (!chat.peer || !(await confirmBlock(chat.peer))) return false;
  if (chat.request === 'pending') await ignoreRequest(chat);
  return true;
}

/** Report them (the report flow offers to block too). */
export function reportRequester(chat: ChatSummary): void {
  const peer = chat.peer;
  if (!peer) return;
  openReport({
    targetType: 'user',
    targetId: peer.id,
    userId: peer.id,
    label: userDisplayName(peer),
  });
}

/**
 * How many Spaces we share (from their profile, loaded once and cached), or null while
 * unknown. `load: false` only reads what is cached.
 */
export function useMutualSpaceCount(userId: ID | null | undefined, load = true): number | null {
  const profile = useProfiles((s) => (userId ? s.byId[userId] : undefined));
  useEffect(() => {
    if (load && userId && !profile)
      void useProfiles
        .getState()
        .load(userId)
        .catch(() => undefined);
  }, [load, userId, profile]);
  return profile ? profile.mutualSpaces.length : null;
}

export function mutualSpacesText(n: number | null): string | null {
  if (!n) return null;
  return `You share ${n} ${n === 1 ? 'Space' : 'Spaces'}`;
}
