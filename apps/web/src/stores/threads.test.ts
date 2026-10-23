/**
 * Threads store and realtime handling: permissions from the parent channel (and the lock),
 * neutral `thread:upsert` merges that keep my read state, the starter card following the
 * thread, popout lists, deletion, the "New Thread" draft and the parent's overwrite changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERM,
  type ChatSummary,
  type PermissionOverwrite,
  type ServerToClientEvents,
  type ThreadInfo,
  type ThreadsPage,
} from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { registerThreadHandlers } from '@/realtime/threads';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { useAuth } from './auth';
import { useChats } from './chats';
import { useMessages, type ChatMessages } from './messages';
import { useSidePanel } from './sidePanel';
import { useSpaces } from './spaces';
import {
  NEW_THREAD_ID,
  defaultThreadName,
  mergeNeutralThread,
  threadPermissions,
  threadRights,
  threadView,
  useSidebarThreads,
  useThreads,
} from './threads';
import { renderHook } from '@testing-library/react';

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.ADD_REACTIONS;
const space = makeSpace({ id: 's1', roles: [{ id: 'everyone', name: '@everyone', color: null, position: 0, permissions: MEMBER, hoist: false, mentionable: false, isDefault: true }] });
const PRIVATE: PermissionOverwrite[] = [{ targetType: 'role', targetId: 'everyone', allow: 0, deny: PERM.VIEW_CHANNEL }];

function spaceInfo(overwrites: PermissionOverwrite[] = []): NonNullable<ChatSummary['space']> {
  return {
    spaceId: 's1',
    categoryId: null,
    position: 0,
    topic: null,
    slowmodeSeconds: 0,
    nsfw: false,
    userLimit: null,
    bitrate: null,
    permissionsSynced: true,
    overwrites,
  };
}

const channel = (p: Partial<ChatSummary> = {}) =>
  makeChat({ id: 'general', type: 'space_text', name: 'general', space: spaceInfo(), spacePermissions: MEMBER, ...p });

function thread(p: Partial<ChatSummary> = {}, info: Partial<ThreadInfo> = {}): ChatSummary {
  return makeChat({
    id: 't1',
    type: 'space_thread',
    name: 'Plans',
    space: spaceInfo(),
    spacePermissions: MEMBER,
    lastActivityAt: '2026-10-20T10:00:00.000Z',
    thread: {
      parentId: 'general',
      starterMessageId: 'm1',
      ownerId: 'me',
      archived: false,
      locked: false,
      autoArchiveMinutes: 4320,
      messageCount: 0,
      ...info,
    },
    ...p,
  });
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on(event: string, fn: (payload: unknown) => void) {
      handlers.set(event, fn);
      return socket;
    },
  } as unknown as AppSocket;
  const fire = <E extends keyof ServerToClientEvents>(event: E, payload: Parameters<ServerToClientEvents[E]>[0]) =>
    handlers.get(event)!(payload);
  return { socket, fire };
}

function seedWindow(chatId: string, items: ReturnType<typeof makeMessage>[]) {
  useMessages.setState((s) => ({
    byChat: {
      ...s.byChat,
      [chatId]: { ...(s.byChat[chatId] as ChatMessages | undefined), items, loaded: true, hasMoreBefore: false, hasMoreAfter: false } as ChatMessages,
    },
  }));
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useSpaces.setState({ byId: { s1: space }, order: ['s1'], loaded: true, channelsLoaded: { s1: true } });
  useChats.setState({ byId: { general: channel() } });
});

afterEach(() => {
  useChats.setState({ byId: {} });
  useMessages.setState({ byChat: {} });
  useSpaces.setState({ byId: {}, order: [], channelsLoaded: {} });
  useThreads.setState({ lists: {}, draft: null, recent: [], starters: {}, followed: {} });
  useSidePanel.setState({ panel: null });
  vi.restoreAllMocks();
});

describe('thread permissions', () => {
  it('a thread reads like a text channel; locked, only moderators send', () => {
    expect(threadPermissions(MEMBER, thread().thread).canSend).toBe(true);
    expect(threadPermissions(MEMBER, thread({}, { locked: true }).thread).canSend).toBe(false);
    expect(threadPermissions(MEMBER | PERM.MANAGE_MESSAGES, thread({}, { locked: true }).thread).canSend).toBe(true);
    expect(threadPermissions(0, thread().thread).canSend).toBe(false);
  });

  it('bits come from the live parent channel’s overwrites (a private parent hides the thread)', () => {
    const open = threadView(thread(), space, channel(), 'me');
    expect(open.permissions.canSend).toBe(true);
    const hidden = threadView(thread(), space, channel({ space: spaceInfo(PRIVATE) }), 'me');
    expect(hidden.bits & PERM.VIEW_CHANNEL).toBe(0);
    expect(hidden.permissions.canSend).toBe(false);
  });

  it('default names come from the starter message (mentions out, 100 characters)', () => {
    expect(defaultThreadName(makeMessage({ text: 'hey @{00000000-0000-4000-8000-000000000001} look' }))).toBe('hey look');
    expect(defaultThreadName(makeMessage({ text: 'x'.repeat(150) }))).toHaveLength(100);
    expect(defaultThreadName(makeMessage({ text: null }))).toBe('Thread');
  });
});

describe('thread:upsert', () => {
  it('keeps my read state and recomputes my permissions; unknown threads start unread-free', () => {
    const cached = thread({ lastSeq: 4, lastReadSeq: 4, unreadCount: 0, mutedUntil: '2099-01-01T00:00:00.000Z' });
    const incoming = thread({ name: 'Plans v2', lastSeq: 6, lastReadSeq: 6, permissions: threadPermissions(0, null), spacePermissions: 0, lastActivityAt: '2026-10-21T10:00:00.000Z' }, { messageCount: 6 });
    const merged = mergeNeutralThread(cached, incoming);
    expect(merged).toMatchObject({ name: 'Plans v2', lastSeq: 6, lastReadSeq: 4, mutedUntil: cached.mutedUntil });
    expect(merged.thread?.messageCount).toBe(6);
    expect(mergeNeutralThread(undefined, incoming)).toMatchObject({ lastReadSeq: 0, unreadCount: 0 });

    const { socket, fire } = fakeSocket();
    registerThreadHandlers(socket);
    fire('thread:upsert', { thread: incoming });
    const stored = useChats.getState().byId.t1!;
    expect(stored.permissions.canSend).toBe(true);
    expect(stored.spacePermissions! & MEMBER).toBe(MEMBER);
  });

  it('moves the starter card and the popout lists along (archive → archived list)', () => {
    seedWindow('general', [makeMessage({ id: 'm1', chatId: 'general', seq: 1 })]);
    useChats.getState().upsertChat(thread());
    useThreads.setState({ lists: { general: { active: ['t1'], archived: [], archivedCursor: null, loading: false } } });
    const { socket, fire } = fakeSocket();
    registerThreadHandlers(socket);
    fire('thread:upsert', { thread: thread({ lastSeq: 3 }, { archived: true, messageCount: 3 }) });
    const starter = useMessages.getState().byChat.general!.items[0]!;
    expect(starter.thread).toMatchObject({ id: 't1', messageCount: 3, archived: true });
    expect(useThreads.getState().lists.general).toMatchObject({ active: [], archived: ['t1'] });
  });

  it('thread:deleted drops the thread, the starter card and the panel on it', () => {
    seedWindow('general', [makeMessage({ id: 'm1', chatId: 'general', seq: 1, thread: { id: 't1', name: 'Plans', messageCount: 1, lastMessageAt: null, archived: false } })]);
    useChats.getState().upsertChat(thread());
    useThreads.getState().openThread({ id: 't1', parentId: 'general' });
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 't1', parentId: 'general' });
    const { socket, fire } = fakeSocket();
    registerThreadHandlers(socket);
    fire('thread:deleted', { threadId: 't1', parentId: 'general' });
    expect(useChats.getState().byId.t1).toBeUndefined();
    expect(useMessages.getState().byChat.general!.items[0]!.thread).toBeNull();
    expect(useSidePanel.getState().panel).toBeNull();
    expect(useThreads.getState().recent).not.toContain('t1');
  });

  it('a parent made private (chat:updated { space }) takes its threads’ permissions with it', () => {
    useChats.getState().upsertChat(thread());
    const { socket, fire } = fakeSocket();
    registerThreadHandlers(socket);
    useChats.getState().patchChat('general', { space: spaceInfo(PRIVATE) });
    fire('chat:updated', { chatId: 'general', changes: { space: spaceInfo(PRIVATE) } });
    const t = useChats.getState().byId.t1!;
    expect(t.space?.overwrites).toEqual(PRIVATE);
    expect(t.spacePermissions! & PERM.VIEW_CHANNEL).toBe(0);
  });

  it('a deleted channel takes its threads along (chat:removed)', () => {
    useChats.getState().upsertChat(thread());
    const { socket, fire } = fakeSocket();
    registerThreadHandlers(socket);
    fire('chat:removed', { chatId: 'general' });
    expect(useChats.getState().byId.t1).toBeUndefined();
  });
});

describe('following', () => {
  it('a neutral upsert keeps whether I follow it (it carries no such thing)', () => {
    const cached = thread({}, { following: true, pinned: false });
    const incoming = thread({ name: 'Renamed' }, { pinned: true });
    expect(mergeNeutralThread(cached, incoming).thread).toMatchObject({ following: true, pinned: true });
    expect(mergeNeutralThread(undefined, incoming).thread?.following).toBeUndefined();
  });

  it('loads a Space’s followed list once; thread:follow keeps it and the summaries in step', async () => {
    const followed = thread({ id: 'f1' }, { following: true, ownerId: 'x' });
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) =>
      path === '/api/spaces/s1/followed-threads' ? { threads: [followed] } : thread({ id: 'late' }, { following: true }),
    );
    await Promise.all([useThreads.getState().loadFollowed('s1'), useThreads.getState().loadFollowed('s1')]);
    await useThreads.getState().loadFollowed('s1');
    expect(get).toHaveBeenCalledTimes(1);
    expect(useThreads.getState().followed.s1).toEqual(['f1']);
    expect(useChats.getState().byId.f1?.thread?.following).toBe(true);

    useChats.getState().upsertChat(thread());
    const { socket, fire } = fakeSocket();
    registerThreadHandlers(socket);
    fire('thread:follow', { threadId: 't1', parentId: 'general', spaceId: 's1', following: true });
    expect(useThreads.getState().followed.s1).toEqual(['t1', 'f1']);
    expect(useChats.getState().byId.t1?.thread?.following).toBe(true);
    fire('thread:follow', { threadId: 'f1', parentId: 'general', spaceId: 's1', following: false });
    expect(useThreads.getState().followed.s1).toEqual(['t1']);
    expect(useChats.getState().byId.f1?.thread?.following).toBe(false);
    // Followed elsewhere, not loaded here: fetched.
    fire('thread:follow', { threadId: 'late', parentId: 'general', spaceId: 's1', following: true });
    await vi.waitFor(() => expect(useChats.getState().byId.late?.thread?.following).toBe(true));
    expect(get).toHaveBeenCalledWith('/api/chats/late');
  });

  it('my REST summaries say whether I follow (a thread I just started: yes)', () => {
    useThreads.setState({ followed: { s1: [] } });
    useThreads.getState().upsertThread(thread({}, { following: true }));
    expect(useThreads.getState().followed.s1).toEqual(['t1']);
    useThreads.getState().upsertThread(thread({}, { following: false }));
    expect(useThreads.getState().followed.s1).toEqual([]);
  });

  it('post rights: moderators pin; the author deletes their own post while it is unlocked', () => {
    const mine = thread({}, { ownerId: 'me' });
    expect(threadRights(mine, 'me', { post: true })).toMatchObject({ canEdit: true, canPin: false, canDelete: true });
    expect(threadRights(mine, 'me')).toMatchObject({ canDelete: false });
    expect(threadRights(thread({}, { ownerId: 'me', locked: true }), 'me', { post: true })).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    expect(threadRights(thread({}, { ownerId: 'x' }), 'me', { post: true })).toMatchObject({ canEdit: false, canDelete: false });
    const mod = thread({ spacePermissions: MEMBER | PERM.MANAGE_MESSAGES }, { ownerId: 'x' });
    expect(threadRights(mod, 'me', { post: true })).toMatchObject({ canPin: true, canLock: true, canDelete: true });
    expect(threadRights(mod, 'me')).toMatchObject({ canPin: false });
  });
});

describe('lists, sidebar and the draft', () => {
  it('loads active and archived pages (Load more appends)', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (_path, opts) => {
      const q = (opts as { query?: { archived?: string; before?: string } } | undefined)?.query ?? {};
      if (!q.archived) return { threads: [thread()], nextCursor: null } satisfies ThreadsPage;
      if (!q.before) return { threads: [thread({ id: 'a1' }, { archived: true })], nextCursor: 'c1' } satisfies ThreadsPage;
      return { threads: [thread({ id: 'a2' }, { archived: true })], nextCursor: null } satisfies ThreadsPage;
    });
    await useThreads.getState().loadThreads('general');
    await useThreads.getState().loadThreads('general', { archived: true });
    await useThreads.getState().loadThreads('general', { archived: true, more: true });
    expect(get).toHaveBeenCalledWith('/api/chats/general/threads', expect.objectContaining({ query: expect.objectContaining({ before: 'c1' }) }));
    expect(useThreads.getState().lists.general).toMatchObject({ active: ['t1'], archived: ['a1', 'a2'], archivedCursor: null, loading: false });
    expect(useChats.getState().byId.a2?.thread?.archived).toBe(true);
  });

  it('the sidebar nests the active threads I own, read or opened — not the others', () => {
    useChats.getState().upsertChats([
      thread({ id: 'mine' }),
      thread({ id: 'read', lastSeq: 3, lastReadSeq: 2 }, { ownerId: 'x' }),
      thread({ id: 'other', lastSeq: 3, lastReadSeq: 0 }, { ownerId: 'x' }),
      thread({ id: 'old' }, { archived: true }),
    ]);
    const { result, rerender } = renderHook(() => useSidebarThreads('general'));
    expect(result.current.map((t) => t.id).sort()).toEqual(['mine', 'read']);
    useThreads.getState().openThread({ id: 'other', parentId: 'general' });
    rerender();
    expect(result.current.map((t) => t.id).sort()).toEqual(['mine', 'other', 'read']);
  });

  it('a draft from a message posts the thread then its first message, and opens it', async () => {
    const starter = makeMessage({ id: 'm1', chatId: 'general', seq: 1, text: 'shall we plan?' });
    useThreads.getState().startDraft('general', starter);
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: NEW_THREAD_ID, parentId: 'general' });
    expect(useThreads.getState().draft).toEqual({ parentId: 'general', messageId: 'm1', name: 'shall we plan?' });
    const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) =>
      path === '/api/chats/general/threads'
        ? thread()
        : makeMessage({ id: 'r1', chatId: 't1', seq: 1, senderId: 'me', text: 'first!', clientId: (body as { clientId: string }).clientId }),
    );
    useThreads.getState().setDraftName('Plans');
    await useThreads.getState().submitDraft('first!');
    expect(post).toHaveBeenCalledWith('/api/chats/general/threads', { name: 'Plans', messageId: 'm1' });
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats/t1/messages', expect.objectContaining({ type: 'text', text: 'first!' })),
    );
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 't1', parentId: 'general' });
    expect(useThreads.getState().draft).toBeNull();
    expect(useThreads.getState().starters.t1?.thread?.id).toBe('t1');
  });
});
