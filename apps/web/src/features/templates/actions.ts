/**
 * Space templates: the REST calls, the share link, and creating a Space (blank, from a
 * starter or from a template code) that opens its first text channel.
 */
import {
  isVoiceChannelType,
  type ChatSummary,
  type CreateSpaceRequest,
  type CreateTemplateRequest,
  type ID,
  type SpaceDetail,
  type SpaceTemplate,
  type UpdateTemplateRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useSpaces } from '@/stores/spaces';

const base = (spaceId: ID) => `/api/spaces/${spaceId}/templates`;

export function getTemplate(code: string): Promise<SpaceTemplate> {
  return api.get<SpaceTemplate>(`/api/templates/${encodeURIComponent(code)}`);
}

export function listTemplates(spaceId: ID): Promise<SpaceTemplate[]> {
  return api.get<SpaceTemplate[]>(base(spaceId));
}

export function createTemplate(spaceId: ID, body: CreateTemplateRequest): Promise<SpaceTemplate> {
  return api.post<SpaceTemplate>(base(spaceId), body);
}

export function updateTemplate(
  spaceId: ID,
  code: string,
  body: UpdateTemplateRequest,
): Promise<SpaceTemplate> {
  return api.patch<SpaceTemplate>(`${base(spaceId)}/${code}`, body);
}

/** Re-snapshot the Space as it is now. */
export function syncTemplate(spaceId: ID, code: string): Promise<SpaceTemplate> {
  return api.put<SpaceTemplate>(`${base(spaceId)}/${code}`);
}

export function deleteTemplate(spaceId: ID, code: string): Promise<void> {
  return api.delete(`${base(spaceId)}/${code}`);
}

/** The link anyone signed in can build a Space from. */
export function templateLink(code: string): string {
  return `${location.origin}/template/${code}`;
}

/** A new Space's first text channel in sidebar order (categories, text before voice). */
export function firstTextChannel(detail: SpaceDetail): ChatSummary | undefined {
  const cats = new Map(detail.space.categories.map((c) => [c.id, c.position]));
  const key = (c: ChatSummary) => [
    c.space?.categoryId ? (cats.get(c.space.categoryId) ?? 0) : -1,
    isVoiceChannelType(c.type) ? 1 : 0,
    c.space?.position ?? 0,
  ];
  return detail.channels
    .filter((c) => c.type === 'space_text')
    .sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      return ka[0]! - kb[0]! || ka[1]! - kb[1]! || ka[2]! - kb[2]!;
    })[0];
}

/** Create a Space (store + channels) and return the path of its first text channel. */
export async function createSpaceAndPath(body: CreateSpaceRequest): Promise<string> {
  const detail = await useSpaces.getState().createSpace(body);
  const first = firstTextChannel(detail);
  return first ? `/spaces/${detail.space.id}/${first.id}` : `/spaces/${detail.space.id}`;
}
