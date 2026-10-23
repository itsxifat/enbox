/**
 * Forum channels (Discord model): the post lists of each forum, the posts' first messages, and
 * my view of each forum (sort, layout, tag filter, search).
 *
 * - A post is a thread of its forum (`space_thread`, `thread.parentId` = the forum): its
 *   ChatSummary lives in the chats store like any thread, so `thread:upsert`, `message:new`,
 *   renames, archiving and tag edits reach it unchanged (stores/threads.ts, realtime/). The
 *   list shown is computed from the chats store (`selectForumPosts`) within the window of the
 *   pages loaded for the current filter: keyset pages of `GET /chats/:id/posts`, open posts
 *   first, then archived ones. New posts and posts with new replies show up at once.
 * - `firstMessages`: each post's own message (seq 1) from the pages and from my new posts;
 *   a live post that arrived by socket shows its `lastMessage` while it has no replies.
 * - Views: sort and layout are remembered per forum on this device; the tag filter and the
 *   search only for the session. Without a choice the forum's own defaults apply.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_FORUM_SETTINGS,
  type ChatSummary,
  type CreateForumPostRequest,
  type ForumInfo,
  type ForumPostsPage,
  type ForumSettings,
  type ID,
  type Message,
} from '@enbox/shared';
import { applyReactionChange, isMyReaction, myReactionsOf, sameReaction } from '@/features/conversation/bubbles/reactions/model';
import { api } from '@/lib/api';
import { probeMedia, stripImageBlob } from '@/lib/media';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { storage } from '@/lib/storage';
import { getMyId } from './auth';
import { useChats } from './chats';
import { useMessages } from './messages';
import { useThreads } from './threads';
import { toast } from './ui';
import { useUsers } from './users';

export type ForumSort = ForumSettings['defaultSort'];
export type ForumLayout = ForumSettings['layout'];

/** Posts per page (the server allows up to 50). */
export const FORUM_PAGE_SIZE = 25;
const VIEWS_KEY = 'enbox.forums.views';

/** What the list shows: the order and the filters. */
export interface ForumFilter {
  sort: ForumSort;
  /** Only posts wearing this tag. */
  tag: string | null;
  /** Title search. */
  q: string;
}

/** My view of a forum: the filter and the layout. */
export interface ForumView extends ForumFilter {
  layout: ForumLayout;
}

/** One loaded part of a forum list (its open or its archived posts) for one filter. */
export interface ForumSection {
  /** Keyset cursor of the next page; null once everything is loaded. */
  cursor: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

export interface ForumList {
  /** The filter the sections were loaded for (`filterKey`). */
  key: string;
  open: ForumSection;
  archived: ForumSection;
}

/** A post being written. */
export interface NewPostInput {
  name: string;
  text: string;
  appliedTags: string[];
  image?: File | null;
  /** Kept across retries of the same post (idempotent on the server). */
  clientId: string;
}

export interface ForumsState {
  lists: Record<ID, ForumList>;
  /** The first message of each post seen (null: deleted for good). */
  firstMessages: Record<ID, Message | null>;
  /** My view choices per forum (missing fields: the forum's defaults). */
  views: Record<ID, Partial<ForumView>>;

  setView(forumId: ID, patch: Partial<ForumView>): void;
  /** Load the first (or, with `more`, the next) page of a forum's open or archived posts. */
  loadPosts(forumId: ID, filter: ForumFilter, opts?: { archived?: boolean; more?: boolean }): Promise<void>;
  /** Create a post (uploading its image first); the post lands in the chats store. */
  createPost(forumId: ID, input: NewPostInput): Promise<ChatSummary>;
  /** The card's default reaction: add mine, or take it back. */
  toggleReaction(post: ChatSummary, message: Message, emoji: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The forum info of a forum channel, with the defaults when the summary has none. */
export function forumOf(chat: Pick<ChatSummary, 'space'> | undefined): ForumInfo {
  return chat?.space?.forum ?? { tags: [], settings: { ...DEFAULT_FORUM_SETTINGS } };
}

/** My view of a forum: my choices over the forum's defaults. */
export function viewOf(forum: ForumInfo, mine: Partial<ForumView> | undefined): ForumView {
  const tag = mine?.tag && forum.tags.some((t) => t.id === mine.tag) ? mine.tag : null;
  return {
    sort: mine?.sort ?? forum.settings.defaultSort,
    layout: mine?.layout ?? forum.settings.layout,
    tag,
    q: mine?.q ?? '',
  };
}

export function filterKey(f: ForumFilter): string {
  return JSON.stringify([f.sort, f.tag ?? '', f.q.trim().toLocaleLowerCase()]);
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/** Whether a post passes the filter's tag and search (the server's rules, client side). */
export function matchesFilter(post: ChatSummary, f: Pick<ForumFilter, 'tag' | 'q'>): boolean {
  if (f.tag && !post.thread?.appliedTags?.includes(f.tag)) return false;
  const q = norm(f.q.trim());
  return !q || norm(post.name ?? '').includes(q);
}

/** The sort key of a post: its last activity or its creation time (ISO strings). */
function sortAt(post: ChatSummary, sort: ForumSort): string {
  return sort === 'created' ? post.createdAt : post.lastActivityAt;
}

/** Newest first, then by id (the server's keyset order). Pure. */
export function sortPosts(posts: readonly ChatSummary[], sort: ForumSort): ChatSummary[] {
  return [...posts].sort((a, b) => {
    const x = sortAt(a, sort);
    const y = sortAt(b, sort);
    if (x !== y) return x < y ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Posts no further down than the last loaded one (when more pages remain). */
function within(sorted: ChatSummary[], section: ForumSection | undefined, sort: ForumSort): ChatSummary[] {
  if (!section?.loaded || !section.cursor) return sorted;
  const [at = '', id = ''] = section.cursor.split('|');
  const atMs = Date.parse(at);
  return sorted.filter((p) => {
    const ms = Date.parse(sortAt(p, sort));
    return ms > atMs || (ms === atMs && p.id >= id);
  });
}

/**
 * The posts a forum shows for `filter`: its open posts, then — once those are all loaded and
 * the archived ones were asked for — its archived posts; each part sorted and cut at the
 * last loaded page. Before the first page arrives, the posts the store already has. Pure.
 */
export function selectForumPosts(
  byId: Record<ID, ChatSummary>,
  forumId: ID,
  filter: ForumFilter,
  list: ForumList | undefined,
): { open: ChatSummary[]; archived: ChatSummary[] } {
  const current = list?.key === filterKey(filter) ? list : undefined;
  const posts = Object.values(byId).filter((c) => c.thread?.parentId === forumId && matchesFilter(c, filter));
  const open = sortPosts(
    posts.filter((p) => !p.thread?.archived),
    filter.sort,
  );
  const archived = current?.archived.loaded
    ? sortPosts(
        posts.filter((p) => p.thread?.archived),
        filter.sort,
      )
    : [];
  return {
    open: within(open, current?.open, filter.sort),
    archived: within(archived, current?.archived, filter.sort),
  };
}

/**
 * A post's first message: the live copy when the post is open (its window holds seq 1), the
 * one the list or my post brought, else its last message while it is still the first. Pure.
 */
export function firstMessageOf(
  post: ChatSummary,
  known: Message | null | undefined,
  live: Message | undefined,
): Message | null {
  if (live) return live;
  if (known !== undefined) return known;
  return post.lastMessage?.seq === 1 ? post.lastMessage : null;
}

const emptySection = (): ForumSection => ({ cursor: null, loaded: false, loading: false, error: null });
const emptyList = (key: string): ForumList => ({ key, open: emptySection(), archived: emptySection() });

type StoredViews = Record<ID, Pick<ForumView, 'sort' | 'layout'>>;

function loadViews(): Record<ID, Partial<ForumView>> {
  const raw = storage.getJSON<unknown>(VIEWS_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<ID, Partial<ForumView>> = {};
  for (const [id, v] of Object.entries(raw as Record<string, Partial<ForumView>>)) {
    const view: Partial<ForumView> = {};
    if (v?.sort === 'activity' || v?.sort === 'created') view.sort = v.sort;
    if (v?.layout === 'list' || v?.layout === 'gallery') view.layout = v.layout;
    out[id] = view;
  }
  return out;
}

function saveViews(views: Record<ID, Partial<ForumView>>): void {
  const out: StoredViews = {};
  for (const [id, v] of Object.entries(views))
    if (v.sort || v.layout) out[id] = { ...(v.sort ? { sort: v.sort } : {}), ...(v.layout ? { layout: v.layout } : {}) } as StoredViews[ID];
  storage.setJSON(VIEWS_KEY, out);
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useForums = create<ForumsState>((set, get) => ({
  lists: {},
  firstMessages: {},
  views: loadViews(),

  setView(forumId, patch) {
    set((s) => ({ views: { ...s.views, [forumId]: { ...s.views[forumId], ...patch } } }));
    if ('sort' in patch || 'layout' in patch) saveViews(get().views);
  },

  async loadPosts(forumId, filter, opts = {}) {
    const key = filterKey(filter);
    const archived = !!opts.archived;
    const part = archived ? 'archived' : 'open';
    const cur = get().lists[forumId]?.key === key ? get().lists[forumId]! : emptyList(key);
    const section = cur[part];
    if (opts.more && (!section.loaded || !section.cursor)) return;
    if (section.loading) return;
    const epoch = sessionEpoch();
    // A new filter replaces the forum's list; a reply for an older filter only feeds the caches.
    set((s) => ({
      lists: { ...s.lists, [forumId]: { ...cur, [part]: { ...section, loading: true, error: null } } },
    }));
    const patchSection = (p: Partial<ForumSection>) =>
      set((s) => {
        const list = s.lists[forumId];
        if (list?.key !== key) return s;
        return { lists: { ...s.lists, [forumId]: { ...list, [part]: { ...list[part], ...p } } } };
      });
    try {
      const page = await api.get<ForumPostsPage>(`/api/chats/${forumId}/posts`, {
        query: {
          sort: filter.sort,
          tag: filter.tag ?? undefined,
          q: filter.q.trim() || undefined,
          archived: archived ? 'true' : undefined,
          before: opts.more ? (section.cursor ?? undefined) : undefined,
          limit: FORUM_PAGE_SIZE,
        },
      });
      if (epoch !== sessionEpoch()) return;
      useUsers.getState().upsertUsers(page.users);
      useChats.getState().upsertChats(page.posts.map((p) => p.thread));
      set((s) => {
        const firstMessages = { ...s.firstMessages };
        for (const p of page.posts) firstMessages[p.thread.id] = p.firstMessage;
        return { firstMessages };
      });
      patchSection({ cursor: page.nextCursor, loaded: true, loading: false });
    } catch (e) {
      if (epoch !== sessionEpoch()) return;
      patchSection({ loading: false, error: e instanceof Error ? e.message : 'Could not load posts' });
      throw e;
    }
  },

  async createPost(forumId, input) {
    let mediaId: string | undefined;
    if (input.image) {
      const meta = await probeMedia(input.image, 'image');
      const media = await api.upload(await stripImageBlob(input.image), meta, undefined, { fileName: input.image.name });
      mediaId = media.id;
    }
    const body: CreateForumPostRequest = {
      name: input.name.trim(),
      text: input.text,
      appliedTags: input.appliedTags,
      clientId: input.clientId,
      ...(mediaId ? { mediaId } : {}),
    };
    const post = await api.post<ChatSummary>(`/api/chats/${forumId}/posts`, body);
    useThreads.getState().upsertThread(post);
    if (post.lastMessage?.seq === 1) {
      const first = post.lastMessage;
      set((s) => ({ firstMessages: { ...s.firstMessages, [post.id]: first } }));
    }
    return post;
  },

  async toggleReaction(post, message, emoji) {
    const me = getMyId();
    if (!me) return;
    const mine = isMyReaction(message, me, emoji);
    const stored = mine
      ? (myReactionsOf(message, me).find((e) => sameReaction(e, emoji)) ?? emoji)
      : (message.reactions.find((r) => sameReaction(r.emoji, emoji))?.emoji ?? emoji);
    const apply = (add: boolean) => {
      const change = { emoji: stored, userId: me, add };
      const known = get().firstMessages[post.id];
      const base = known ?? message;
      const next = applyReactionChange(base, change, { me, listed: false });
      if (next) set((s) => ({ firstMessages: { ...s.firstMessages, [post.id]: { ...base, ...next } } }));
      useMessages.getState().patchReactions(post.id, message.id, (m) => applyReactionChange(m, change, { me, listed: false }));
    };
    apply(!mine);
    try {
      if (mine) await api.delete(`/api/messages/${message.id}/reactions/${enc(stored)}/@me`);
      else await api.put(`/api/messages/${message.id}/reactions/${enc(stored)}/@me`);
    } catch (e) {
      apply(mine);
      toast.error(e);
    }
  },
}));

registerSessionReset(() => {
  useForums.setState({ lists: {}, firstMessages: {}, views: loadViews() });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The posts a forum shows for `filter` (see `selectForumPosts`). */
export function useForumPosts(forumId: ID, filter: ForumFilter): { open: ChatSummary[]; archived: ChatSummary[] } {
  const byId = useChats((s) => s.byId);
  const list = useForums((s) => s.lists[forumId]);
  const { sort, tag, q } = filter;
  return useMemo(() => selectForumPosts(byId, forumId, { sort, tag, q }, list), [byId, forumId, sort, tag, q, list]);
}

/** A post's first message (see `firstMessageOf`). */
export function useFirstMessage(post: ChatSummary): Message | null {
  const known = useForums((s) => s.firstMessages[post.id]);
  const live = useMessages((s) => s.byChat[post.id]?.items.find((m) => m.seq === 1));
  return firstMessageOf(post, known, live);
}
