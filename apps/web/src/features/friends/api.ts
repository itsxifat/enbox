/**
 * Friend invite links (everyday wave): mine (list, create, revoke all), and someone's link
 * (preview, accept). Accepting makes us friends at once: the friends and contacts stores are
 * resynced right away (the server's `friends:changed` / `contacts:changed` follow anyway).
 */
import type { FriendInvite, FriendInviteAccepted, FriendInvitePreview } from '@enbox/shared';
import { api } from '@/lib/api';
import { publicOrigin } from '@/lib/serverConfig';
import { useContacts } from '@/stores/contacts';
import { useFriends } from '@/stores/friends';

/** Absolute `/friend/:code` URL on the canonical origin (like Space invites' `/join/:code`). */
export function friendInviteUrl(code: string): string {
  return `${publicOrigin()}/friend/${code}`;
}

/** My live links, newest first. */
export function listFriendInvites(): Promise<FriendInvite[]> {
  return api.get<FriendInvite[]>('/api/me/friend-invites');
}

export function createFriendInvite(): Promise<FriendInvite> {
  return api.post<FriendInvite>('/api/me/friend-invites');
}

export async function revokeFriendInvites(): Promise<void> {
  await api.delete('/api/me/friend-invites');
}

export function previewFriendInvite(
  code: string,
  signal?: AbortSignal,
): Promise<FriendInvitePreview> {
  return api.get<FriendInvitePreview>(`/api/friend-invites/${code}`, { signal });
}

export async function acceptFriendInvite(code: string): Promise<FriendInviteAccepted> {
  const res = await api.post<FriendInviteAccepted>(`/api/friend-invites/${code}/accept`);
  if (res.status === 'friends') {
    void useContacts.getState().syncContacts();
    void useFriends.getState().sync();
  }
  return res;
}
