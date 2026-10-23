/**
 * The forum part of the channel routes (modules/spaces/routes.ts): a `space_forum` channel's
 * tags and options on create, PATCH and clone. The shared request schemas only type these
 * fields (schemas.ts cannot import community.ts): they are validated here with community.ts's
 * `forumTagsSchema` / `forumSettingsSchema`, emoji checked like reactions.
 *
 * Tag ids are the client's and stay as given: a PATCH sends the whole list, a tag keeps its id
 * when renamed, and a tag left out is taken off the forum's posts in the same transaction.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_FORUM_SETTINGS,
  forumSettingsSchema,
  forumTagsSchema,
  reactionEmojiSchema,
  type ChatType,
  type ForumSettings,
  type ForumTag,
} from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { chats, type ChatRow } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { forumInfoOf } from '../../services/threads.js';

type ForumColumns = Partial<Pick<ChatRow, 'forumTags' | 'forumSettings'>>;

interface ForumFields {
  forumTags?: unknown;
  forumSettings?: unknown;
}

/** A unicode emoji or a custom emoji token (as reactions accept), or null when empty. */
function emojiOrNull(value: string | null | undefined, field: string): string | null {
  if (!value) return null;
  if (!reactionEmojiSchema.safeParse(value).success) throw badRequest(`${field}: must be an emoji`);
  return value;
}

/** A forum's tag list (≤ MAX_FORUM_TAGS, unique ids). */
export function parseForumTags(input: unknown): ForumTag[] {
  return parse(forumTagsSchema, input).map((t, i) => ({
    id: t.id,
    name: t.name,
    emoji: emojiOrNull(t.emoji, `forumTags.${i}.emoji`),
    moderated: t.moderated,
  }));
}

/** `input` (partial settings) over `current`; empty guidelines or reaction mean none. */
export function mergeForumSettings(current: ForumSettings, input: unknown): ForumSettings {
  const next = { ...current, ...parse(forumSettingsSchema, input) };
  return {
    layout: next.layout,
    defaultSort: next.defaultSort,
    requireTag: next.requireTag,
    defaultReaction: emojiOrNull(next.defaultReaction, 'forumSettings.defaultReaction'),
    guidelines: next.guidelines?.trim() ? next.guidelines : null,
    media: next.media ?? false,
    hideDownloads: next.hideDownloads ?? false,
  };
}

/**
 * The forum columns of a new channel: its tags (none by default) and DEFAULT_FORUM_SETTINGS
 * (a media channel's posts show as a grid unless a layout is given).
 */
export function newForumColumns(type: ChatType, body: ForumFields): ForumColumns {
  if (type !== 'space_forum') return {};
  const input = parse(forumSettingsSchema, body.forumSettings ?? {});
  const defaults: ForumSettings = input.media
    ? { ...DEFAULT_FORUM_SETTINGS, layout: 'gallery' }
    : DEFAULT_FORUM_SETTINGS;
  return {
    forumTags: body.forumTags === undefined ? [] : parseForumTags(body.forumTags),
    forumSettings: mergeForumSettings(defaults, input),
  };
}

/** A clone of `source` takes its tags and options. */
export function clonedForumColumns(source: ChatRow): ForumColumns {
  if (source.type !== 'space_forum') return {};
  const info = forumInfoOf(source);
  return { forumTags: info.tags, forumSettings: info.settings };
}

/**
 * A channel PATCH's forum columns (forums only: other channels ignore the fields, like any
 * field of another channel type) and the ids of the tags it removes.
 */
export function forumPatch(
  chat: ChatRow,
  body: ForumFields,
): { patch: ForumColumns; removedTagIds: string[] } {
  const patch: ForumColumns = {};
  if (chat.type !== 'space_forum') return { patch, removedTagIds: [] };
  const info = forumInfoOf(chat);
  let removedTagIds: string[] = [];
  if (body.forumTags !== undefined) {
    const tags = parseForumTags(body.forumTags);
    const kept = new Set(tags.map((t) => t.id));
    removedTagIds = info.tags.filter((t) => !kept.has(t.id)).map((t) => t.id);
    patch.forumTags = tags;
  }
  if (body.forumSettings !== undefined)
    patch.forumSettings = mergeForumSettings(info.settings, body.forumSettings);
  return { patch, removedTagIds };
}

/**
 * Take removed tags off the forum's posts: one statement over the posts wearing one of them
 * (their `updated_at`, the archive clock, untouched). No event: clients only show the tags
 * the forum still has, and the posts' next summaries carry the cleaned lists.
 */
export async function dropTagsFromPosts(
  dbx: DbOrTx,
  forumId: string,
  tagIds: readonly string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const removed = sql`array[${sql.join(
    tagIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  await dbx
    .update(chats)
    .set({
      appliedTags: sql`array(select u.t from unnest(${chats.appliedTags}) with ordinality as u(t, i)
                             where u.t <> all(${removed}) order by u.i)`,
    })
    .where(and(eq(chats.parentId, forumId), sql`${chats.appliedTags} && ${removed}`));
}
