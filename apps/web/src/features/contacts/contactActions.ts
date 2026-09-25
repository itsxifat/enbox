/**
 * Contact/chat actions shared by the new-chat pane, contact info and profile pages (agent 1).
 */
import { userDisplayName, type ChatSummary, type ID, type UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { confirm, toast } from '@/stores/ui';

/** POST /api/chats/direct (idempotent; `userId = me` → "Message yourself") and cache it. */
export async function openDirectChat(userId: ID): Promise<ChatSummary> {
  const chat = await api.post<ChatSummary>('/api/chats/direct', { userId });
  useChats.getState().upsertChat(chat);
  return chat;
}

/** Confirm + DELETE /api/contacts/:id. */
export async function deleteContactFlow(user: UserPublic): Promise<boolean> {
  const name = userDisplayName(user);
  const ok = await confirm({
    title: `Delete ${name} from your contacts?`,
    message:
      'Your chat history stays. They will see less of your profile if your privacy is set to “My contacts”.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  try {
    await useContacts.getState().removeContact(user.id);
    toast.success(`${user.displayName} removed from contacts`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** Save someone I already know (by id) as a contact, optionally under a name. */
export async function saveContact(user: UserPublic, name?: string): Promise<boolean> {
  try {
    await useContacts.getState().addContact({ userId: user.id, ...(name ? { name } : {}) });
    toast.success(`${name || user.displayName} added to contacts`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export async function confirmBlock(user: UserPublic): Promise<boolean> {
  const name = userDisplayName(user);
  const ok = await confirm({
    title: `Block ${name}?`,
    message:
      'Blocked contacts can’t call you or send you messages, and won’t see your last seen, online status, profile photo or about.',
    confirmLabel: 'Block',
    danger: true,
  });
  if (!ok) return false;
  try {
    await useContacts.getState().block(user.id);
    toast.success(`${name} blocked`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export async function confirmUnblock(user: UserPublic): Promise<boolean> {
  const name = userDisplayName(user);
  const ok = await confirm({ title: `Unblock ${name}?`, confirmLabel: 'Unblock' });
  if (!ok) return false;
  try {
    await useContacts.getState().unblock(user.id);
    toast.success(`${name} unblocked`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}
