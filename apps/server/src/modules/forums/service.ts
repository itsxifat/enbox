/**
 * Forums module service (Discord forum channels): list a forum's posts and create one.
 *
 * A forum (`space_forum`) holds no messages of its own (a send is a 400, services/chats.ts
 * `assertCanSend`): each post is a thread of it — a `space_thread` row whose `parent_id` is the
 * forum — and the post's first message lives inside the thread (`thread_starter_id` null).
 * Posts are threads in every other respect (services/threads.ts): the forum's permissions,
 * the forum's room for `thread:upsert` and message events, replies, reads, rename, archive,
 * lock and delete through the chats/messages/threads routes with the post's id, tags through
 * `PATCH /threads/:threadId { appliedTags }`. The forum's own tags and options are edited
 * with the channel PATCH (modules/spaces/routes.ts).
 *
 * Permissions: VIEW_CHANNEL lists (404 otherwise); SEND_MESSAGES creates posts (Discord's
 * meaning of it in a forum), ATTACH_FILES with media; moderated tags need MANAGE_MESSAGES (it
 * stands in for MANAGE_THREADS, see modules/threads).
 *
 * A media channel is a forum with `forum_settings.media`: every post leads with a picture or
 * a video (its tile in the grid). The pinned post (one per forum, `chats.thread_pinned`) leads
 * the list.
 */
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  PERM,
  USER_RATE_LIMITS,
  hasPerm,
  referencedUserIds,
  type ChatSummary,
  type ForumPost,
  type ForumPostsPage,
  type MessageType,
  type createForumPostSchema,
  type forumPostsQuerySchema,
} from '@enbox/shared';
import { db, type Tx } from '../../db/index.js';
import { chats, messages } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { enforceAutoMod } from '../../services/automod.js';
import { getChatAccess, requireActiveMember } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { requireOwnedMedia } from '../../services/media.js';
import { insertMessage, toMessages, type CreateMessageInput } from '../../services/messages.js';
import { ensureSpaceReadRow, requireSpaceBit } from '../../services/spaceAccess.js';
import { gateExternalEmoji } from '../../services/spaceEmojis.js';
import {
  assertSpaceVerification,
  spaceSendRules,
  touchSlowmode,
} from '../../services/spaceRules.js';
import { spaceChannelSummariesForPairs } from '../../services/spaceSummaries.js';
import { pairKey, uniq, uuidArray } from '../../services/sql.js';
import {
  DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES,
  forumInfoOf,
  resolvePostTags,
} from '../../services/threads.js';
import { toUserPublics } from '../../services/users.js';
import { mediaAttachmentsOf } from '../messages/service.js';
import { autoFollowThread } from '../threads/follow.js';
import { THREAD_CREATE_LIMIT } from '../threads/service.js';

export type CreatePostBody = z.output<typeof createForumPostSchema>;
export type PostsQueryOut = z.output<typeof forumPostsQuerySchema>;

/** A retried post (same clientId) is recognised this long after its last activity. */
export const POST_RETRY_WINDOW_MS = 24 * 3600_000;

/** The viewer's summary of a post (404 when they cannot see it). */
async function postSummaryFor(userId: string, postId: string): Promise<ChatSummary> {
  const s = (await spaceChannelSummariesForPairs(db, [{ chatId: postId, userId }])).get(
    pairKey(postId, userId),
  );
  if (!s) throw notFound('Post');
  return s;
}

/**
 * The post I already created in this forum with `clientId` (a retry), if any. Only posts
 * active within POST_RETRY_WINDOW_MS are looked at: the parent index range bounds the scan,
 * and the unique (chat, sender, client id) index finds the first message of each.
 */
async function findRetriedPost(
  tx: Tx,
  forumId: string,
  me: string,
  clientId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: chats.id })
    .from(chats)
    .innerJoin(
      messages,
      and(
        eq(messages.chatId, chats.id),
        eq(messages.senderId, me),
        eq(messages.clientId, clientId),
      ),
    )
    .where(
      and(
        eq(chats.parentId, forumId),
        gt(chats.lastMessageAt, new Date(Date.now() - POST_RETRY_WINDOW_MS)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * `POST /chats/:chatId/posts` → the post's ChatSummary (201; 200 for a retry with the same
 * clientId: nothing written or emitted). One transaction under the forum's row lock: my
 * SEND_MESSAGES (ATTACH_FILES with media), the Space's verification level, the forum's
 * slowmode (one post per interval, moderators exempt), the tags (`resolvePostTags`), the files
 * (up to 10 with alt text, as a media send takes them; a media channel's posts lead with a
 * picture or a video), AutoMod (title and text), then the thread and its first message
 * (`insertMessage`; the post itself is not counted as a reply), and I follow it.
 * Events after commit, in order: the thread registers in the room registry, `thread:upsert` →
 * the forum's room, the first message's `message:new` & co., then `thread:follow` → my
 * devices. Rate limits: one thread creation and one message send.
 */
export async function createPost(
  me: string,
  forumId: string,
  body: CreatePostBody,
): Promise<{ post: ChatSummary; created: boolean }> {
  assertUserLimit(me, 'threadCreate', THREAD_CREATE_LIMIT);
  assertUserLimit(me, 'sendMessage', USER_RATE_LIMITS.sendMessage);
  const { postId, created } = await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, forumId, { lock: true });
    const forum = access.chat;
    if (forum.type !== 'space_forum' || !forum.spaceId || !access.space)
      throw badRequest('Posts can only be created in forum channels');
    const retried = await findRetriedPost(tx, forumId, me, body.clientId);
    if (retried) return { postId: retried, created: false };
    requireSpaceBit(access, PERM.SEND_MESSAGES, 'You cannot create posts in this forum');
    const info = forumInfoOf(forum);
    const appliedTags = resolvePostTags(info, body.appliedTags, {
      moderator: hasPerm(access.space.bits, PERM.MANAGE_MESSAGES),
    });

    let type: MessageType = 'text';
    let attachments: CreateMessageInput['attachments'];
    if (body.mediaId) {
      const kind = (await requireOwnedMedia(tx, body.mediaId, me)).kind;
      attachments = await mediaAttachmentsOf(tx, me, {
        clientId: body.clientId,
        type: kind,
        mediaId: body.mediaId,
        extraMediaIds: body.extraMediaIds,
        descriptions: body.descriptions,
      });
      type = kind;
    } else if (body.extraMediaIds?.length) {
      throw badRequest('mediaId: The first file goes in mediaId');
    }
    if (info.settings.media && type !== 'image' && type !== 'video')
      throw badRequest('mediaId: Posts in this channel need a picture or a video');
    const text = body.text.trim() ? body.text : null;
    if (!text && !body.mediaId) throw badRequest('text: write something or add a file');
    // Attachments, the forum's slowmode, and which @everyone / @role mentions count.
    const spaceMentions = spaceSendRules(access, me, { type, text });
    await assertSpaceVerification(tx, access, me);
    // AutoMod reads the title with the text (a block rolls the post back).
    await enforceAutoMod(tx, fx, access, me, { text: text ? `${body.name}\n${text}` : body.name });

    const [post] = await tx
      .insert(chats)
      .values({
        type: 'space_thread',
        name: body.name,
        spaceId: forum.spaceId,
        parentId: forumId,
        threadAutoArchiveMinutes: DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES,
        appliedTags,
        createdBy: me,
        // The archive clock starts now (and keyset paging needs a value).
        lastMessageAt: new Date(),
      })
      .returning();
    const first = await insertMessage(tx, {
      chatId: post!.id,
      senderId: me,
      type,
      clientId: body.clientId,
      text: text ? await gateExternalEmoji(tx, access, text) : null,
      mediaId: body.mediaId ?? null,
      attachments,
      spaceMentions,
      opensThread: true,
    });
    first.publish(fx);
    // Discord's message count leaves the post's own message out.
    await tx.update(chats).set({ threadMessageCount: 0 }).where(eq(chats.id, post!.id));
    if (forum.slowmodeSeconds > 0) {
      await ensureSpaceReadRow(tx, forum, me, access.space.me.member.joinedAt);
      await touchSlowmode(tx, access, me);
    }
    await autoFollowThread(tx, post!.id, me, fx);
    return { postId: post!.id, created: true };
  });
  return { post: await postSummaryFor(me, postId), created };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function parseCursor(before: string | undefined): { at: string; id: string } | null {
  if (!before) return null;
  const [at, id] = before.split('|');
  const time = at ? Date.parse(at) : NaN;
  if (!id || Number.isNaN(time) || !/^[0-9a-f-]{36}$/i.test(id))
    throw badRequest('before: invalid cursor');
  return { at: new Date(time).toISOString(), id: id.toLowerCase() };
}

/** `q` as an ILIKE pattern matching it anywhere (its own `%`, `_` and `\` taken literally). */
const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * `GET /chats/:chatId/posts?sort=&tag=&q=&archived=&before=&limit=` (VIEW_CHANNEL on the
 * forum, 404 otherwise): its open posts — or its archived ones — by last activity
 * (`sort=activity`, keyset on (last_message_at, id): the parent index) or newest first
 * (`sort=created`, on (created_at, id)); the forum's default sort when omitted. `tag` keeps
 * the posts wearing it, `q` matches titles. The pinned post, when it passes the filter, leads
 * the first page (one more than `limit`) and is left out of the keyset pages. Each post comes
 * with its first message (one query for the page: seq 1 of each thread, null once deleted for
 * good) and the page with the users it shows (authors and the people the first messages
 * mention).
 */
export async function listPosts(
  me: string,
  forumId: string,
  q: PostsQueryOut,
): Promise<ForumPostsPage> {
  const access = await getChatAccess(db, me, forumId);
  if (access.chat.type !== 'space_forum') throw badRequest('Not a forum channel');
  const sort = q.sort ?? forumInfoOf(access.chat).settings.defaultSort;
  const key = sort === 'created' ? chats.createdAt : chats.lastMessageAt;
  const cursor = parseCursor(q.before);
  const filter = and(
    eq(chats.parentId, forumId),
    q.archived ? isNotNull(chats.threadArchivedAt) : isNull(chats.threadArchivedAt),
    q.tag ? sql`${q.tag} = any(${chats.appliedTags})` : undefined,
    q.q ? sql`${chats.name} ilike ${containsPattern(q.q)}` : undefined,
  );
  const columns = { id: chats.id, createdAt: chats.createdAt, lastMessageAt: chats.lastMessageAt };
  const pinned = cursor
    ? []
    : await db
        .select(columns)
        .from(chats)
        .where(and(filter, eq(chats.threadPinned, true)))
        .limit(1);
  const rows = await db
    .select(columns)
    .from(chats)
    .where(
      and(
        filter,
        eq(chats.threadPinned, false),
        cursor
          ? sql`(${key}, ${chats.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(key), desc(chats.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const ids = [...pinned, ...page].map((r) => r.id);
  const summaries = await spaceChannelSummariesForPairs(
    db,
    ids.map((chatId) => ({ chatId, userId: me })),
  );
  const firstRows = ids.length
    ? await db
        .select()
        .from(messages)
        .where(and(sql`${messages.chatId} = any(${uuidArray(ids)})`, eq(messages.seq, 1)))
    : [];
  const firsts = await toMessages(db, me, firstRows, {
    chatTypes: new Map(ids.map((id) => [id, 'space_thread' as const])),
  });
  const firstOf = new Map(firsts.map((m) => [m.chatId, m]));
  const posts: ForumPost[] = [];
  for (const id of ids) {
    const thread = summaries.get(pairKey(id, me));
    if (thread) posts.push({ thread, firstMessage: firstOf.get(id) ?? null });
  }
  const userIds = uniq(
    [...posts.map((p) => p.thread.createdBy), ...firsts.flatMap(referencedUserIds)].filter(
      (id): id is string => !!id,
    ),
  );
  const last = page.at(-1);
  const lastAt = last ? (sort === 'created' ? last.createdAt : (last.lastMessageAt ?? last.createdAt)) : null;
  return {
    posts,
    nextCursor: rows.length > q.limit && last && lastAt ? `${lastAt.toISOString()}|${last.id}` : null,
    users: await toUserPublics(db, me, userIds),
  };
}
