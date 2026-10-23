/**
 * Threads of Space text channels (Discord model).
 *
 * - A thread's `ChatSummary` (`type: 'space_thread'`, `thread` = ThreadInfo) lives in the chats
 *   store like any Space channel, so history, sends, unread and `message:new` work unchanged.
 *   This store keeps what is thread-specific: the Threads popout lists per channel (active /
 *   archived pages), the "New Thread" draft, the threads I opened recently (the sidebar shows
 *   them under their channel) and starter messages seen on the way in.
 * - `thread:upsert` carries a viewer-NEUTRAL summary: it only refreshes the thread's shared
 *   fields; my read state is kept and my permissions are computed here (`threadView`) from
 *   the Space, the parent channel's overwrites and the lock.
 * - The panel beside the channel is `useSidePanel()` `{ kind: 'thread', threadId, parentId }`;
 *   `NEW_THREAD_ID` as the thread id opens the draft.
 * - Following: `thread.following` of my summaries (kept across neutral merges) and the ids I
 *   follow per Space (`followed`, loaded when its sidebar shows; `thread:follow` keeps both in
 *   step). Once a Space's list is in, its sidebar nests the threads and posts I follow.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  PERM,
  hasPerm,
  spaceChannelPermissions,
  type ChatPermissions,
  type ChatSummary,
  type CreateThreadRequest,
  type FollowedThreads,
  type ID,
  type Message,
  type MessageThreadRef,
  type Space,
  type ThreadFollowEvent,
  type ThreadsPage,
  type UpdateThreadRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useAuth } from './auth';
import { useChats } from './chats';
import { useMessages } from './messages';
import { useSidePanel } from './sidePanel';
import { channelBitsFor, useSpaces } from './spaces';

/** The side panel's thread id while a new thread is being written. */
export const NEW_THREAD_ID = 'new';
/** Threads remembered as recently opened (the sidebar lists the active ones). */
export const RECENT_THREADS_MAX = 30;
const RECENT_KEY = 'enbox.threads.recent';

export interface ThreadList {
  /** Thread ids, most recent activity first (null = not loaded). */
  active: ID[] | null;
  archived: ID[] | null;
  /** Keyset cursor of the next archived page (null = no more). */
  archivedCursor: string | null;
  loading: boolean;
}

export interface ThreadDraft {
  parentId: ID;
  /** Start it from this message of the channel. */
  messageId: ID | null;
  name: string;
}

export interface ThreadsState {
  lists: Record<ID, ThreadList>;
  draft: ThreadDraft | null;
  /** Thread ids I opened, newest first (persisted per device). */
  recent: ID[];
  /** Starter messages seen when opening a thread (the parent's window may not hold them). */
  starters: Record<ID, Message>;
  /** The posts and threads I follow, per Space id (absent until loaded). */
  followed: Record<ID, ID[]>;

  loadThreads(parentId: ID, opts?: { archived?: boolean; more?: boolean }): Promise<void>;
  /** What I follow in a Space (`GET /spaces/:id/followed-threads`): once, unless `force`. */
  loadFollowed(spaceId: ID, opts?: { force?: boolean }): Promise<void>;
  /** Follow or unfollow a post or thread (at once; undone when the server refuses). */
  setFollowing(threadId: ID, following: boolean): Promise<void>;
  /** `thread:follow`: one of my devices followed or unfollowed something. */
  applyFollow(e: ThreadFollowEvent): void;
  /** A thread summary from REST (viewer-specific) or `thread:upsert` (`neutral`). */
  upsertThread(thread: ChatSummary, opts?: { neutral?: boolean }): void;
  removeThread(threadId: ID, parentId: ID): void;
  /** Open the panel on a thread (remembered for the sidebar). */
  openThread(thread: Pick<ChatSummary, 'id'> & { parentId: ID }, starter?: Message | null): void;
  /** Open the panel on a new thread of `parentId`, optionally from one of its messages. */
  startDraft(parentId: ID, message?: Message | null): void;
  setDraftName(name: string): void;
  /** Create the drafted thread and post its first message; the panel switches to it. */
  submitDraft(firstMessage: string): Promise<ChatSummary>;
  updateThread(threadId: ID, patch: UpdateThreadRequest): Promise<ChatSummary>;
  deleteThread(threadId: ID): Promise<void>;
  forgetRecent(threadId: ID): void;
}

const emptyList = (): ThreadList => ({ active: null, archived: null, archivedCursor: null, loading: false });

function loadRecent(): ID[] {
  const ids = storage.getJSON<unknown>(RECENT_KEY);
  return Array.isArray(ids) ? ids.filter((x): x is ID => typeof x === 'string').slice(0, RECENT_THREADS_MAX) : [];
}

const saveRecent = (ids: ID[]) => storage.setJSON(RECENT_KEY, ids);

const myId = () => useAuth.getState().user?.id ?? '';

// ---------------------------------------------------------------------------
// Permissions and refs (pure)
// ---------------------------------------------------------------------------

/** My `ChatPermissions` in a thread from my bits in it: a text channel's, minus sending when locked. */
export function threadPermissions(bits: number, info: ChatSummary['thread']): ChatPermissions {
  const p = spaceChannelPermissions(bits, 'space_text');
  if (info?.locked && !hasPerm(bits, PERM.MANAGE_MESSAGES)) p.canSend = false;
  return p;
}

/**
 * My bits and permissions in a thread: the parent channel's overwrites (the live parent when
 * loaded, else the copy the thread carries), computed like a text channel. Pure.
 */
export function threadView(
  thread: ChatSummary,
  space: Space | undefined,
  parent: ChatSummary | undefined,
  me: ID,
): { bits: number; permissions: ChatPermissions } {
  if (!space || !thread.space) return { bits: 0, permissions: threadPermissions(0, thread.thread) };
  const overwrites = parent?.space?.overwrites ?? thread.space.overwrites;
  const bits = channelBitsFor(space, { type: 'space_thread', space: { ...thread.space, overwrites } }, me);
  return { bits, permissions: threadPermissions(bits, thread.thread) };
}

/** The starter message's `thread` ref from a thread summary. */
export function threadRefOf(thread: ChatSummary): MessageThreadRef {
  return {
    id: thread.id,
    name: thread.name ?? 'Thread',
    messageCount: thread.thread?.messageCount ?? 0,
    lastMessageAt: thread.lastActivityAt,
    archived: !!thread.thread?.archived,
  };
}

/**
 * Merge a `thread:upsert` (viewer-neutral) into the cached thread: its shared fields win, my
 * read state, mute, preview and following stay. An unknown thread starts with nothing read
 * (like the server's read position without a read row) and no count. Pure.
 */
export function mergeNeutralThread(cached: ChatSummary | undefined, incoming: ChatSummary): ChatSummary {
  if (!cached) return { ...incoming, lastReadSeq: 0, unreadCount: 0, unreadMentionCount: 0 };
  const newer = incoming.lastActivityAt > cached.lastActivityAt;
  const following = cached.thread?.following;
  return {
    ...cached,
    name: incoming.name,
    thread: incoming.thread && following !== undefined ? { ...incoming.thread, following } : incoming.thread,
    space: incoming.space,
    createdBy: incoming.createdBy,
    memberCount: incoming.memberCount,
    lastSeq: Math.max(cached.lastSeq, incoming.lastSeq),
    lastActivityAt: newer ? incoming.lastActivityAt : cached.lastActivityAt,
  };
}

/** A starter message's text as a default thread name (mention tokens dropped). */
export function defaultThreadName(m: Pick<Message, 'text'> | null | undefined): string {
  const text = (m?.text ?? '')
    .replace(/@\{[^}]*\}/g, '')
    .replace(/<a?:([A-Za-z0-9_]{2,32}):[0-9a-f-]{36}>/g, ':$1:')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, 100).join('').trim() || 'Thread';
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Put threads into the chats store (permissions computed when the payload has none). */
function intoChats(threads: ChatSummary[], neutral: boolean): void {
  if (!threads.length) return;
  const chats = useChats.getState();
  const me = myId();
  const out = threads.map((t) => {
    // REST summaries carry my permissions already; a neutral one gets them computed here.
    if (!neutral) return t;
    const merged = mergeNeutralThread(chats.byId[t.id], t);
    const space = merged.space ? useSpaces.getState().byId[merged.space.spaceId] : undefined;
    const parent = merged.thread ? chats.byId[merged.thread.parentId] : undefined;
    const view = threadView(merged, space, parent, me);
    return { ...merged, spacePermissions: view.bits, permissions: view.permissions };
  });
  if (neutral) {
    // Neutral merges are complete summaries: write them as they are (no lastSeq rollback logic).
    for (const t of out) {
      if (chats.byId[t.id]) chats.patchChat(t.id, t);
      else chats.upsertChat(t);
    }
  } else chats.upsertChats(out);
}

/** Update the starter message's `thread` card in the parent channel's loaded messages. */
function patchStarter(thread: ChatSummary): void {
  const starterId = thread.thread?.starterMessageId;
  if (!starterId || !thread.thread) return;
  useMessages.getState().patchMessage(thread.thread.parentId, starterId, { thread: threadRefOf(thread) });
  const stashed = useThreads.getState().starters[thread.id];
  if (stashed)
    useThreads.setState((s) => ({ starters: { ...s.starters, [thread.id]: { ...stashed, thread: threadRefOf(thread) } } }));
}

/** Keep the popout lists in step with a changed thread (moves between active and archived). */
function placeInLists(lists: Record<ID, ThreadList>, thread: ChatSummary): Record<ID, ThreadList> {
  const parentId = thread.thread?.parentId;
  const cur = parentId ? lists[parentId] : undefined;
  if (!parentId || !cur) return lists;
  const archived = !!thread.thread?.archived;
  const without = (ids: ID[] | null) => (ids ? ids.filter((id) => id !== thread.id) : ids);
  const next: ThreadList = { ...cur, active: without(cur.active), archived: without(cur.archived) };
  if (archived) {
    if (next.archived) next.archived = [thread.id, ...next.archived];
  } else if (next.active) next.active = [thread.id, ...next.active];
  return { ...lists, [parentId]: next };
}

/**
 * Followed or not: the thread's summary (when loaded) and its Space's followed ids (when
 * loaded) say so.
 */
function markFollowing(threadId: ID, spaceId: ID | undefined, following: boolean): void {
  const chats = useChats.getState();
  const info = chats.byId[threadId]?.thread;
  if (info && !!info.following !== following) chats.patchChat(threadId, { thread: { ...info, following } });
  if (!spaceId) return;
  useThreads.setState((s) => {
    const ids = s.followed[spaceId];
    if (!ids || ids.includes(threadId) === following) return s;
    return { followed: { ...s.followed, [spaceId]: following ? [threadId, ...ids] : ids.filter((id) => id !== threadId) } };
  });
}

let loadSeq = 0;
/** `loadFollowed` requests in flight, per Space. */
const followLoads = new Map<ID, Promise<void>>();

export const useThreads = create<ThreadsState>((set, get) => ({
  lists: {},
  draft: null,
  recent: loadRecent(),
  starters: {},
  followed: {},

  async loadThreads(parentId, opts = {}) {
    const archived = !!opts.archived;
    const cur = get().lists[parentId] ?? emptyList();
    if (archived && opts.more && !cur.archivedCursor) return;
    const epoch = sessionEpoch();
    const seq = ++loadSeq;
    set((s) => ({ lists: { ...s.lists, [parentId]: { ...cur, loading: true } } }));
    try {
      const page = await api.get<ThreadsPage>(`/api/chats/${parentId}/threads`, {
        query: {
          archived: archived ? 'true' : undefined,
          before: archived && opts.more ? (cur.archivedCursor ?? undefined) : undefined,
          limit: 50,
        },
      });
      if (epoch !== sessionEpoch()) return;
      intoChats(page.threads, false);
      const ids = page.threads.map((t) => t.id);
      set((s) => {
        const base = s.lists[parentId] ?? emptyList();
        const next: ThreadList = archived
          ? {
              ...base,
              archived: opts.more ? [...(base.archived ?? []), ...ids.filter((id) => !base.archived?.includes(id))] : ids,
              archivedCursor: page.nextCursor,
            }
          : { ...base, active: ids };
        return { lists: { ...s.lists, [parentId]: { ...next, loading: seq === loadSeq ? false : base.loading } } };
      });
    } catch (e) {
      set((s) => ({ lists: { ...s.lists, [parentId]: { ...(s.lists[parentId] ?? emptyList()), loading: false } } }));
      throw e;
    }
  },

  async loadFollowed(spaceId, opts = {}) {
    const inFlight = followLoads.get(spaceId);
    if (inFlight) return inFlight;
    if (get().followed[spaceId] && !opts.force) return;
    const epoch = sessionEpoch();
    const p = api
      .get<FollowedThreads>(`/api/spaces/${spaceId}/followed-threads`)
      .then((res) => {
        if (epoch !== sessionEpoch()) return;
        intoChats(res.threads, false);
        set((s) => ({ followed: { ...s.followed, [spaceId]: res.threads.map((t) => t.id) } }));
      })
      .finally(() => followLoads.delete(spaceId));
    followLoads.set(spaceId, p);
    return p;
  },

  async setFollowing(threadId, following) {
    const info = useChats.getState().byId[threadId];
    const spaceId = info?.space?.spaceId;
    const was = !!info?.thread?.following;
    markFollowing(threadId, spaceId, following);
    try {
      if (following) get().upsertThread(await api.put<ChatSummary>(`/api/threads/${threadId}/follow`));
      else await api.delete(`/api/threads/${threadId}/follow`);
    } catch (e) {
      markFollowing(threadId, spaceId, was);
      throw e;
    }
  },

  applyFollow(e) {
    markFollowing(e.threadId, e.spaceId, e.following);
    // Followed on another device: a thread this one has not loaded yet.
    if (e.following && !useChats.getState().byId[e.threadId]) void useChats.getState().refreshChat(e.threadId).catch(() => undefined);
  },

  upsertThread(thread, opts = {}) {
    if (thread.type !== 'space_thread' || !thread.thread) return;
    intoChats([thread], !!opts.neutral);
    const fresh = useChats.getState().byId[thread.id] ?? thread;
    patchStarter(fresh);
    set((s) => ({ lists: placeInLists(s.lists, fresh) }));
    // My summaries say whether I follow it (a post or thread I just made: yes).
    if (!opts.neutral && thread.thread.following !== undefined)
      markFollowing(thread.id, thread.space?.spaceId, thread.thread.following);
  },

  removeThread(threadId, parentId) {
    const chats = useChats.getState();
    const starterId = chats.byId[threadId]?.thread?.starterMessageId;
    chats.removeChat(threadId);
    useMessages.getState().dropChat(threadId);
    // The starter's card goes (its id may be unknown here: find it by the ref).
    const items = useMessages.getState().byChat[parentId]?.items ?? [];
    for (const m of items)
      if (m.id === starterId || m.thread?.id === threadId)
        useMessages.getState().patchMessage(parentId, m.id, { thread: null });
    set((s) => {
      const cur = s.lists[parentId];
      const starters = { ...s.starters };
      delete starters[threadId];
      return {
        starters,
        recent: s.recent.filter((id) => id !== threadId),
        lists: cur
          ? {
              ...s.lists,
              [parentId]: {
                ...cur,
                active: cur.active?.filter((id) => id !== threadId) ?? null,
                archived: cur.archived?.filter((id) => id !== threadId) ?? null,
              },
            }
          : s.lists,
      };
    });
    saveRecent(get().recent);
    const panel = useSidePanel.getState().panel;
    if (panel?.kind === 'thread' && panel.threadId === threadId) useSidePanel.getState().close();
  },

  openThread(thread, starter) {
    set((s) => ({
      recent: [thread.id, ...s.recent.filter((id) => id !== thread.id)].slice(0, RECENT_THREADS_MAX),
      starters: starter ? { ...s.starters, [thread.id]: starter } : s.starters,
      draft: null,
    }));
    saveRecent(get().recent);
    useSidePanel.getState().open({ kind: 'thread', threadId: thread.id, parentId: thread.parentId });
  },

  startDraft(parentId, message) {
    set({ draft: { parentId, messageId: message?.id ?? null, name: message ? defaultThreadName(message) : '' } });
    if (message) set((s) => ({ starters: { ...s.starters, [`${NEW_THREAD_ID}:${message.id}`]: message } }));
    useSidePanel.getState().open({ kind: 'thread', threadId: NEW_THREAD_ID, parentId });
  },

  setDraftName(name) {
    const d = get().draft;
    if (d) set({ draft: { ...d, name } });
  },

  async submitDraft(firstMessage) {
    const d = get().draft;
    if (!d) throw new Error('No thread draft');
    const body: CreateThreadRequest = {
      name: d.name.trim() || defaultThreadName({ text: firstMessage }),
      ...(d.messageId ? { messageId: d.messageId } : {}),
    };
    const thread = await api.post<ChatSummary>(`/api/chats/${d.parentId}/threads`, body);
    get().upsertThread(thread);
    const draftKey = `${NEW_THREAD_ID}:${d.messageId}`;
    const starter = d.messageId ? get().starters[draftKey] : undefined;
    if (starter)
      set((s) => {
        const starters = { ...s.starters };
        delete starters[draftKey];
        return { starters };
      });
    get().openThread({ id: thread.id, parentId: d.parentId }, starter ? { ...starter, thread: threadRefOf(thread) } : null);
    const text = firstMessage.trim();
    if (text) void useMessages.getState().sendMessage(thread.id, { type: 'text', text }).catch(() => undefined);
    return thread;
  },

  async updateThread(threadId, patch) {
    const thread = await api.patch<ChatSummary>(`/api/threads/${threadId}`, patch);
    get().upsertThread(thread);
    return thread;
  },

  async deleteThread(threadId) {
    const parentId = useChats.getState().byId[threadId]?.thread?.parentId;
    await api.delete(`/api/threads/${threadId}`);
    if (parentId) get().removeThread(threadId, parentId);
  },

  forgetRecent(threadId) {
    set((s) => ({ recent: s.recent.filter((id) => id !== threadId) }));
    saveRecent(get().recent);
  },
}));

registerSessionReset(() => {
  loadSeq = 0;
  followLoads.clear();
  useThreads.setState({ lists: {}, draft: null, starters: {}, recent: loadRecent(), followed: {} });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The loaded threads of a channel (newest activity first); archived ones only with `archived`. */
export function useChannelThreads(parentId: ID | null | undefined, opts: { archived?: boolean } = {}): ChatSummary[] {
  const byId = useChats((s) => s.byId);
  const archived = !!opts.archived;
  return useMemo(() => {
    if (!parentId) return [];
    return Object.values(byId)
      .filter((c) => c.thread?.parentId === parentId && !!c.thread.archived === archived)
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0));
  }, [byId, parentId, archived]);
}

/**
 * The threads the sidebar nests under a channel (Discord: the active threads I joined), oldest
 * first like Discord's list: the ones I follow and the one open in the panel. Until the Space's
 * followed list is in, a text channel's threads not known either way (a summary without
 * `following`) also show when I own, read (a read position) or recently opened them.
 */
export function useSidebarThreads(parentId: ID): ChatSummary[] {
  const byId = useChats((s) => s.byId);
  const recent = useThreads((s) => s.recent);
  const me = useAuth((s) => s.user?.id);
  const openId = useSidePanel((s) => (s.panel?.kind === 'thread' ? s.panel.threadId : null));
  const parent = byId[parentId];
  const spaceId = parent?.space?.spaceId;
  const followedIn = useThreads((s) => (spaceId ? s.followed[spaceId] !== undefined : false));
  const guess = !followedIn && parent?.type !== 'space_forum';
  return useMemo(() => {
    const recentSet = new Set(recent);
    return Object.values(byId)
      .filter(
        (c) =>
          c.thread?.parentId === parentId &&
          !c.thread.archived &&
          (c.id === openId ||
            !!c.thread.following ||
            (guess &&
              c.thread.following === undefined &&
              (recentSet.has(c.id) || (!!me && c.thread.ownerId === me) || c.lastReadSeq > 0))),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }, [byId, recent, me, openId, parentId, guess]);
}

/**
 * What I may do with a thread: manage it (MANAGE_MESSAGES: lock, pin a post), edit it as its
 * creator while unlocked (rename, tags, archive — a post: close and reopen) and delete it
 * (moderators; a forum post's author too while it is unlocked, `post`).
 */
export function threadRights(thread: ChatSummary, me: ID | undefined, opts: { post?: boolean } = {}) {
  const bits = thread.spacePermissions ?? 0;
  const moderator = hasPerm(bits, PERM.MANAGE_MESSAGES);
  const owner = !!me && thread.thread?.ownerId === me;
  const canEdit = moderator || (owner && !thread.thread?.locked);
  return {
    moderator,
    canEdit,
    canLock: moderator,
    canPin: moderator && !!opts.post,
    canDelete: moderator || hasPerm(bits, PERM.MANAGE_CHANNELS) || (!!opts.post && canEdit),
  };
}
