/**
 * Group DM actions (`POST /api/chats/group-dm`, `…/group-dm/members`, the group routes for
 * rename, leave and ownership). Each applies the server's answer to the stores right away;
 * the socket events that follow (`chat:upsert`, `chat:updated`, `chat:members-changed`)
 * merge idempotently.
 */
import { useState } from 'react';
import type { ChatSummary, ID } from '@enbox/shared';
import { Checkbox } from '@/components/ui';
import { useDrafts } from '@/features/chats/drafts';
import { useChatMembersStore } from '@/features/conversation/members';
import { api } from '@/lib/api';
import { getMyId } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { confirm, toast } from '@/stores/ui';

const reloadMembers = (chatId: ID) =>
  void useChatMembersStore.getState().load(chatId, { force: true });

/** A group DM with these friends (one friend → our DM, as the server answers). */
export async function createGroupDm(userIds: ID[], name?: string | null): Promise<ChatSummary> {
  const chat = await api.post<ChatSummary>('/api/chats/group-dm', {
    userIds,
    ...(name ? { name } : {}),
  });
  useChats.getState().upsertChat(chat);
  return chat;
}

/** Any member adds their own friends (up to GROUP_DM_MAX_MEMBERS in all). */
export async function addFriendsToGroupDm(chatId: ID, userIds: ID[]): Promise<ChatSummary> {
  const chat = await api.post<ChatSummary>(`/api/chats/${chatId}/group-dm/members`, { userIds });
  useChats.getState().upsertChat(chat);
  reloadMembers(chatId);
  return chat;
}

/** The owner removes a member ("Remove from Group"); failures toast. */
export async function removeFromGroupDm(chatId: ID, userId: ID): Promise<boolean> {
  try {
    await api.delete(`/api/chats/${chatId}/group-dm/members/${userId}`);
    reloadMembers(chatId);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** The owner hands the group over ("Make Group Owner"); they become a plain member. */
export async function makeGroupDmOwner(chatId: ID, userId: ID): Promise<boolean> {
  try {
    await api.post(`/api/groups/${chatId}/transfer-ownership`, { userId });
    reloadMembers(chatId);
    void useChats
      .getState()
      .refreshChat(chatId)
      .catch(() => undefined);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/**
 * Any member renames it (optimistic, rolled back on failure); an empty name clears it, and
 * its members' names show again.
 */
export async function renameGroupDm(chat: ChatSummary, name: string): Promise<boolean> {
  const next = name.trim() || null;
  if (next === chat.name) return true;
  const before = chat.name;
  useChats.getState().patchChat(chat.id, { name: next });
  try {
    useChats
      .getState()
      .upsertChat(await api.patch<ChatSummary>(`/api/groups/${chat.id}`, { name: next }));
    return true;
  } catch (e) {
    useChats.getState().patchChat(chat.id, { name: before });
    toast.error(e);
    return false;
  }
}

function LeaveMessage({ name, onSilent }: { name: string; onSilent: (silent: boolean) => void }) {
  const [silent, setSilent] = useState(false);
  return (
    <span className="flex flex-col gap-4">
      <span>
        Are you sure you want to leave <strong className="font-semibold text-fg">{name}</strong>?
        You won’t be able to rejoin this group unless you are re-invited.
      </span>
      <Checkbox
        checked={silent}
        onChange={(v) => {
          setSilent(v);
          onSilent(v);
        }}
        label="Leave without notifying other members"
      />
    </span>
  );
}

/**
 * "Leave Group": confirm "Leave '<name>'?" (optionally without telling the others), leave,
 * then drop it from my list as Discord does (being added again brings it back). Resolves
 * true once gone.
 */
export async function leaveGroupDm(chat: ChatSummary, name: string): Promise<boolean> {
  let silent = false;
  const ok = await confirm({
    title: `Leave ‘${name}’?`,
    message: <LeaveMessage name={name} onSilent={(v) => (silent = v)} />,
    confirmLabel: 'Leave Group',
    danger: true,
  });
  if (!ok) return false;
  try {
    // The group route posts "… left"; the group DM route with my id leaves silently.
    if (silent) await api.delete(`/api/chats/${chat.id}/group-dm/members/${getMyId()}`);
    else await api.post(`/api/groups/${chat.id}/leave`);
  } catch (e) {
    toast.error(e);
    return false;
  }
  try {
    await api.delete(`/api/chats/${chat.id}`);
    useChats.getState().removeChat(chat.id);
    useMessages.getState().dropChat(chat.id);
    useDrafts.getState().clearDraft(chat.id);
  } catch {
    // Left, but still listed (as a former member): the server's chat:upsert says so.
  }
  return true;
}
