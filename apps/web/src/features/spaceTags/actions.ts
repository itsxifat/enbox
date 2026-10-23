/**
 * Server tag mutations (REST). Each applies its answer right away: the Space's tag in the
 * spaces store plus the cached users wearing it (the `space:updated` echo merges the same),
 * or my own profile in the users store (`user:changed` refetches it on my other devices).
 */
import type {
  AdoptSpaceTagRequest,
  ID,
  SpaceTag,
  SpaceTagRequest,
  UserPublic,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';

/** A Space's tag is now `tag` (null = none): my copy of the Space and its wearers follow. */
export function applySpaceTag(spaceId: ID, tag: SpaceTag | null): void {
  const spaces = useSpaces.getState();
  const cur = spaces.byId[spaceId];
  if (cur) spaces.upsertSpace({ ...cur, tag });
  useUsers.getState().applySpaceTag(spaceId, tag);
}

export async function saveSpaceTag(spaceId: ID, body: SpaceTagRequest): Promise<SpaceTag> {
  const tag = await api.put<SpaceTag>(`/api/spaces/${spaceId}/tag`, body);
  applySpaceTag(spaceId, tag);
  return tag;
}

export async function removeSpaceTag(spaceId: ID): Promise<void> {
  await api.delete(`/api/spaces/${spaceId}/tag`);
  applySpaceTag(spaceId, null);
}

/** Wear the tag of one of my Spaces, or none (null). */
export async function wearSpaceTag(spaceId: ID | null): Promise<UserPublic> {
  const body: AdoptSpaceTagRequest = { spaceId };
  const user = await api.put<UserPublic>('/api/me/space-tag', body);
  useUsers.getState().upsertUsers([user]);
  return user;
}
