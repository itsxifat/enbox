/**
 * Forum UI: the post list (order by activity or creation, cards with tags, preview, author,
 * counts, gallery covers), the tag filter, the guidelines, the New Post flow (tags, required
 * tags, moderated tags, files with alt text, the post opening beside the forum), the
 * `?thread=` link, the post menu per role (follow, close, lock, pin, edit, delete, download),
 * the pinned post and its marks, media channels (tiles, a picture or video in every post,
 * hidden downloads), the Forum settings tab (tags editor and options), the Forum and Media
 * types of the create dialog, and the store's pure helpers (window of loaded pages, filters,
 * first messages, views).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  DEFAULT_FORUM_SETTINGS,
  PERM,
  type ChatSummary,
  type ForumInfo,
  type ForumPostsPage,
  type ForumSettings,
  type ForumTag,
  type MediaAttachment,
  type Message,
  type ThreadInfo,
} from '@enbox/shared';
import { uploadAll } from '@/features/conversation/lib/sendMedia';
import type * as SendMediaModule from '@/features/conversation/lib/sendMedia';
import { ChannelDialog } from '@/features/spaces/dialogs/ChannelDialog';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChat, useChats } from '@/stores/chats';
import {
  filterKey,
  firstMessageOf,
  matchesFilter,
  selectForumPosts,
  useForums,
  viewOf,
  type ForumFilter,
  type ForumList,
} from '@/stores/forums';
import { useMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpace, useSpaces } from '@/stores/spaces';
import { useThreads } from '@/stores/threads';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { ForumChannelView } from './ForumChannelView';
import { ForumSettingsSection } from './ForumSettingsSection';
import { useHideDownloads } from './media';

vi.mock('@/features/conversation/lib/sendMedia', async (importOriginal) => ({
  ...(await importOriginal<typeof SendMediaModule>()),
  uploadAll: vi.fn(),
}));
vi.mock('@/features/search/HeaderSearch', () => ({ HeaderSearch: () => null }));
vi.mock('@/features/inbox/InboxButton', () => ({ InboxButton: () => null }));
vi.mock('@/features/threads/ThreadPanel', () => ({
  ThreadPanel: ({ threadId }: { threadId: string }) => <div data-testid="thread-panel" data-thread-id={threadId} />,
}));

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.ADD_REACTIONS | PERM.ATTACH_FILES;
const MOD = MEMBER | PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS;

const TAGS: ForumTag[] = [
  { id: 'bug', name: 'Bug', emoji: null, moderated: false },
  { id: 'idea', name: 'Idea', emoji: null, moderated: false },
  { id: 'solved', name: 'Solved', emoji: null, moderated: true },
];

function info(settings: Partial<ForumSettings> = {}, tags: ForumTag[] = TAGS): ForumInfo {
  return { tags, settings: { ...DEFAULT_FORUM_SETTINGS, ...settings } };
}

function spaceInfo(forum?: ForumInfo): NonNullable<ChatSummary['space']> {
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
    overwrites: [],
    ...(forum ? { forum } : {}),
  };
}

const forumChat = (forum = info(), bits = MEMBER) =>
  makeChat({ id: 'f1', type: 'space_forum', name: 'help', space: spaceInfo(forum), spacePermissions: bits });

function post(
  id: string,
  p: { name: string; created: string; active: string; tags?: string[]; replies?: number; archived?: boolean },
): ChatSummary {
  return makeChat({
    id,
    type: 'space_thread',
    name: p.name,
    space: spaceInfo(),
    spacePermissions: MEMBER,
    createdAt: `2026-10-20T${p.created}:00.000Z`,
    lastActivityAt: `2026-10-20T${p.active}:00.000Z`,
    createdBy: 'olive',
    lastSeq: (p.replies ?? 0) + 1,
    lastReadSeq: (p.replies ?? 0) + 1,
    thread: {
      parentId: 'f1',
      starterMessageId: null,
      ownerId: 'olive',
      archived: !!p.archived,
      locked: false,
      autoArchiveMinutes: 4320,
      messageCount: p.replies ?? 0,
      appliedTags: p.tags ?? [],
    },
  });
}

const first = (postId: string, p: Partial<Message> = {}) =>
  makeMessage({ id: `m-${postId}`, chatId: postId, seq: 1, senderId: 'olive', text: `${postId} first message`, ...p });

const ALPHA = post('alpha', { name: 'Alpha', created: '10:00', active: '12:00', tags: ['bug'], replies: 3 });
const BETA = post('beta', { name: 'Beta', created: '11:00', active: '11:30', tags: ['idea'] });
const GAMMA = post('gamma', { name: 'Gamma', created: '09:00', active: '12:30', tags: ['bug', 'idea'], replies: 1 });

function seed(opts: { forum?: ForumInfo; bits?: number; posts?: ChatSummary[] } = {}) {
  const bits = opts.bits ?? MEMBER;
  useSpaces.setState({
    byId: {
      s1: makeSpace({
        id: 's1',
        roles: [{ id: 'everyone', name: '@everyone', color: null, position: 0, permissions: bits, hoist: false, mentionable: false, isDefault: true }],
      }),
    },
    order: ['s1'],
    loaded: true,
    channelsLoaded: { s1: true },
  });
  const chats = [forumChat(opts.forum, bits), ...(opts.posts ?? [])];
  useChats.setState({ byId: Object.fromEntries(chats.map((c) => [c.id, c])), loaded: true });
}

/** The posts page the mocked server answers (filters applied like the server). */
function page(posts: ChatSummary[], query: Record<string, unknown> = {}, messages: Message[] = []): ForumPostsPage {
  const sorted = [...posts]
    .filter((p) => !!p.thread?.archived === (query.archived === 'true'))
    .filter((p) => !query.tag || p.thread?.appliedTags?.includes(String(query.tag)))
    .sort((a, b) =>
      query.sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
  return {
    posts: sorted.map((p) => ({ thread: p, firstMessage: messages.find((m) => m.chatId === p.id) ?? first(p.id) })),
    nextCursor: null,
    users: [],
  };
}

function Harness() {
  const chat = useChat('f1');
  const space = useSpace('s1');
  return chat && space ? <ForumChannelView chat={chat} space={space} /> : null;
}

function renderForum(at = '/spaces/s1/f1') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/spaces/:spaceId/:chatId" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

const titles = () =>
  screen.getAllByTestId('forum-post-card').map((c) => within(c).getByRole('heading').textContent);

let served: ChatSummary[] = [];
let messages: Message[] = [];

beforeEach(() => {
  // The tag picker is a popover (it follows its size).
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Me' }), token: 't', status: 'authenticated' });
  useUsers.setState({ byId: { olive: makeUser({ id: 'olive', displayName: 'Olive' }) } });
  served = [ALPHA, BETA, GAMMA];
  messages = [];
  vi.spyOn(api, 'get').mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) =>
    (path === '/api/chats/f1/posts' ? page(served, opts?.query, messages) : []) as never,
  );
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useChats.setState({ byId: {}, loaded: false });
  useMessages.setState({ byChat: {} });
  useSpaces.setState({ byId: {}, order: [], channelsLoaded: {}, members: {} });
  useThreads.setState({ lists: {}, draft: null, recent: [], starters: {}, followed: {} });
  useForums.setState({ lists: {}, firstMessages: {}, views: {} });
  useSidePanel.setState({ panel: null });
  useUi.setState({ dialogs: [] });
});

describe('ForumChannelView: the post list', () => {
  it('lists posts by recent activity with their tags, author, preview and counts; Creation Time re-sorts', async () => {
    seed({ posts: [ALPHA, BETA, GAMMA] });
    renderForum();
    expect(screen.getByRole('heading', { level: 1, name: 'help' })).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/chats/f1/posts', expect.objectContaining({ query: expect.objectContaining({ sort: 'activity' }) })));
    expect(titles()).toEqual(['Gamma', 'Alpha', 'Beta']);
    const alpha = screen.getAllByTestId('forum-post-card')[1]!;
    expect(within(alpha).getAllByTestId('forum-tag').map((t) => t.textContent)).toEqual(['Bug']);
    await waitFor(() => expect(within(alpha).getByTestId('forum-post-preview')).toHaveTextContent('Olive: alpha first message'));
    expect(within(alpha).getByLabelText('3 replies')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sort: Recent Activity' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Creation Time' }));
    expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma']);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/chats/f1/posts', expect.objectContaining({ query: expect.objectContaining({ sort: 'created' }) })),
    );
    // Remembered for this forum on this device.
    expect(useForums.getState().views.f1?.sort).toBe('created');
  });

  it('a post’s own message, not its latest reply, is its preview; the forum’s default sort applies', async () => {
    seed({ forum: info({ defaultSort: 'created' }), posts: [] });
    messages = [first('alpha', { text: 'The **original** post' })];
    renderForum();
    await waitFor(() => expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma']));
    await waitFor(() => expect(screen.getAllByTestId('forum-post-preview')[1]).toHaveTextContent('Olive: The original post'));
  });

  it('the tag filter keeps the posts wearing the tag and asks the server for them', async () => {
    seed({ posts: [ALPHA, BETA, GAMMA] });
    renderForum();
    await waitFor(() => expect(titles()).toHaveLength(3));
    const filters = screen.getByRole('group', { name: 'Filter by tag' });
    fireEvent.click(within(filters).getByRole('button', { name: 'Idea' }));
    expect(titles()).toEqual(['Gamma', 'Beta']);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/chats/f1/posts', expect.objectContaining({ query: expect.objectContaining({ tag: 'idea' }) })),
    );
    expect(within(filters).getByRole('button', { name: 'Idea' })).toHaveAttribute('aria-pressed', 'true');
    // Again: back to every post.
    fireEvent.click(within(filters).getByRole('button', { name: 'Idea' }));
    expect(titles()).toHaveLength(3);
  });

  it('searching filters the titles; nothing found offers to clear the filters', async () => {
    seed({ posts: [ALPHA, BETA, GAMMA] });
    renderForum();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search posts' }), { target: { value: 'alp' } });
    expect(titles()).toEqual(['Alpha']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search posts' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('No posts match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toHaveLength(3);
  });

  it('gallery cards lead with the post’s image; a click opens the post beside the forum', async () => {
    seed({ posts: [ALPHA, BETA, GAMMA] });
    messages = [first('beta', { type: 'image', text: null, media: { id: 'img', kind: 'image', url: '/uploads/beta.png', thumbnailUrl: null, mimeType: 'image/png', fileName: 'beta.png', size: 10, width: 10, height: 10, animated: false, frameCount: null, durationMs: null, waveform: null } })];
    renderForum();
    await waitFor(() => expect(screen.getByTestId('forum-post-thumbnail')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Layout: List' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Gallery' }));
    const covers = screen.getAllByTestId('forum-post-cover');
    expect(covers).toHaveLength(1);
    expect(covers[0]!.getAttribute('src')).toContain('/uploads/beta.png');

    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'alpha', parentId: 'f1' });
    expect(useThreads.getState().recent[0]).toBe('alpha');
    expect(await screen.findByTestId('thread-panel')).toHaveAttribute('data-thread-id', 'alpha');
  });

  it('shows the guidelines as markdown (collapsible) and an empty forum invites the first post', async () => {
    served = [];
    seed({ forum: info({ guidelines: '**Be kind.** Search first.' }) });
    renderForum();
    const text = screen.getByTestId('forum-guidelines-text');
    expect(text.querySelector('strong')?.textContent).toBe('Be kind.');
    fireEvent.click(screen.getByRole('button', { name: 'Post Guidelines' }));
    expect(screen.queryByTestId('forum-guidelines-text')).toBeNull();
    expect(await screen.findByText('There are no posts yet')).toBeInTheDocument();
    // Archived posts were looked for too before saying so.
    expect(api.get).toHaveBeenCalledWith('/api/chats/f1/posts', expect.objectContaining({ query: expect.objectContaining({ archived: 'true' }) }));
  });

  it('archived posts come after the open ones', async () => {
    const old = post('old', { name: 'Old one', created: '08:00', active: '13:00', archived: true });
    served = [ALPHA, old];
    seed({ posts: [] });
    renderForum();
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Old one']));
    expect(screen.getByText('Older posts')).toBeInTheDocument();
  });

  it('the card menu edits the tags of my post; moderated tags stay with moderators; not on others’ posts', async () => {
    const mine = { ...ALPHA, createdBy: 'me', thread: { ...ALPHA.thread!, ownerId: 'me' } };
    served = [mine, BETA];
    seed({ posts: [] });
    vi.spyOn(api, 'patch').mockResolvedValue({ ...mine, thread: { ...mine.thread, appliedTags: ['bug', 'idea'] } } as never);
    renderForum();
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Beta']));
    const card = (i: number) => screen.getAllByTestId('forum-post-card')[i]!;
    fireEvent.click(within(card(0)).getByRole('button', { name: 'Post options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Tags' }));
    const tags = screen.getByRole('menu', { name: 'Edit Tags' });
    expect(within(tags).getByRole('menuitemcheckbox', { name: 'Bug' })).toHaveAttribute('aria-checked', 'true');
    expect(within(tags).getByRole('menuitemcheckbox', { name: 'Solved' })).toBeDisabled();
    fireEvent.click(within(tags).getByRole('menuitemcheckbox', { name: 'Idea' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/threads/alpha', { appliedTags: ['bug', 'idea'] }));
    await waitFor(() =>
      expect(within(card(0)).getAllByTestId('forum-tag').map((t) => t.textContent)).toEqual(['Bug', 'Idea']),
    );
    fireEvent.click(within(card(1)).getByRole('button', { name: 'Post options' }));
    const others = screen.getByRole('menu', { name: 'Options for Beta' });
    expect(within(others).queryByRole('menuitem', { name: 'Edit Tags' })).toBeNull();
    expect(within(others).getByRole('menuitem', { name: 'Copy Link' })).toBeInTheDocument();
  });

  it('?thread= on the forum’s URL opens that post', () => {
    seed({ posts: [ALPHA] });
    renderForum('/spaces/s1/f1?thread=alpha');
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'alpha', parentId: 'f1' });
  });
});

describe('New Post', () => {
  const created = () =>
    post('new1', { name: 'My question', created: '14:00', active: '14:00', tags: ['idea'] });

  it('creates the post with its title, message and tags, then opens it', async () => {
    seed({ posts: [ALPHA] });
    vi.mocked(api.post).mockImplementation(async (path: string) =>
      (path === '/api/chats/f1/posts' ? { ...created(), lastMessage: first('new1', { text: 'How do I…?' }) } : []) as never,
    );
    renderForum();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search posts' }), { target: { value: 'My question' } });
    fireEvent.click(screen.getByTestId('forum-new-post-button'));
    const form = screen.getByRole('form', { name: 'New Post' });
    // The search text starts the title.
    expect(within(form).getByLabelText('Post title')).toHaveValue('My question');
    expect(within(form).getByTestId('forum-post-submit')).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Post message'), { target: { value: 'How do I…?' } });

    fireEvent.click(within(form).getByRole('button', { name: 'Add Tags' }));
    const picker = screen.getByRole('dialog', { name: 'Tags' });
    // Moderated tags are for moderators.
    expect(within(picker).getByRole('button', { name: 'Solved' })).toBeDisabled();
    fireEvent.click(within(picker).getByRole('button', { name: 'Idea' }));
    expect(within(form).getByLabelText('Selected tags')).toHaveTextContent('Idea');

    fireEvent.click(within(form).getByTestId('forum-post-submit'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/chats/f1/posts', {
        name: 'My question',
        text: 'How do I…?',
        appliedTags: ['idea'],
        clientId: expect.any(String),
      }),
    );
    await waitFor(() => expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'new1', parentId: 'f1' }));
    expect(screen.queryByRole('form', { name: 'New Post' })).toBeNull();
    // The new post is in the list at once, with its first message.
    expect(useChats.getState().byId.new1?.thread?.parentId).toBe('f1');
    expect(useForums.getState().firstMessages.new1?.text).toBe('How do I…?');
  });

  it('a forum that requires tags refuses a post without one', async () => {
    seed({ forum: info({ requireTag: true }), posts: [ALPHA] });
    renderForum();
    fireEvent.click(screen.getByTestId('forum-new-post-button'));
    const form = screen.getByRole('form', { name: 'New Post' });
    fireEvent.change(within(form).getByLabelText('Post title'), { target: { value: 'No tags' } });
    fireEvent.change(within(form).getByLabelText('Post message'), { target: { value: 'Hello' } });
    expect(within(form).getByRole('button', { name: 'Add Tags (required)' })).toBeInTheDocument();
    fireEvent.click(within(form).getByTestId('forum-post-submit'));
    expect(await within(form).findByRole('alert')).toHaveTextContent('This forum requires at least one tag.');
    expect(api.post).not.toHaveBeenCalledWith('/api/chats/f1/posts', expect.anything());
  });

  it('members without SEND_MESSAGES get no New Post', () => {
    seed({ bits: PERM.VIEW_CHANNEL, posts: [ALPHA] });
    renderForum();
    expect(screen.queryByTestId('forum-new-post-button')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search posts' })).toHaveAttribute('placeholder', 'Search posts...');
  });
});

/** A post with more thread info (pinned, closed, locked, following). */
const withInfo = (p: ChatSummary, info: Partial<ThreadInfo>, extra: Partial<ChatSummary> = {}): ChatSummary => ({
  ...p,
  ...extra,
  thread: { ...p.thread!, ...info },
});

/** An uploaded file as the server returns it. */
function upload(id: string, kind: 'image' | 'video', name: string, thumbnailUrl: string | null = null): MediaAttachment {
  return {
    id,
    kind,
    url: `/uploads/${name}`,
    thumbnailUrl,
    mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
    fileName: name,
    size: 10,
    width: 10,
    height: 10,
    animated: false,
    frameCount: null,
    durationMs: null,
    waveform: null,
  };
}

/** Open the post menu of card `i` (closing any other first). */
function openMenu(i: number, name: string, testId = 'forum-post-card'): HTMLElement {
  fireEvent.pointerDown(document.body);
  fireEvent.click(within(screen.getAllByTestId(testId)[i]!).getByRole('button', { name: 'Post options' }));
  return screen.getByRole('menu', { name: `Options for ${name}` });
}

const itemsOf = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((m) => m.textContent ?? '');

/** Choose an item of card `i`'s post menu. */
function choose(i: number, name: string, item: string): void {
  fireEvent.click(within(openMenu(i, name)).getByRole('menuitem', { name: item }));
}

describe('Post actions', () => {
  const mine = () => withInfo(ALPHA, { ownerId: 'me' }, { createdBy: 'me' });

  it('the card menu per role: members follow and copy the link; the author closes, renames and deletes', async () => {
    served = [mine(), BETA];
    seed({ posts: [] });
    renderForum();
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Beta']));
    expect(itemsOf(openMenu(0, 'Alpha'))).toEqual([
      'Open Post',
      'Follow Post',
      'Close Post',
      'Edit Title',
      'Edit Tags',
      'Copy Link',
      'Delete Post',
    ]);
    expect(itemsOf(openMenu(1, 'Beta'))).toEqual(['Open Post', 'Follow Post', 'Copy Link']);

    const put = vi.spyOn(api, 'put').mockResolvedValue(withInfo(BETA, { following: true }) as never);
    choose(1, 'Beta', 'Follow Post');
    expect(put).toHaveBeenCalledWith('/api/threads/beta/follow');
    await waitFor(() => expect(useChats.getState().byId.beta?.thread?.following).toBe(true));
    expect(itemsOf(openMenu(1, 'Beta'))).toContain('Unfollow Post');

    const patch = vi.spyOn(api, 'patch').mockResolvedValue(withInfo(mine(), { archived: true }) as never);
    choose(0, 'Alpha', 'Close Post');
    expect(patch).toHaveBeenCalledWith('/api/threads/alpha', { archived: true });
  });

  it('Edit Title renames the post; Delete Post asks first', async () => {
    served = [mine()];
    seed({ posts: [] });
    renderForum();
    await waitFor(() => expect(titles()).toEqual(['Alpha']));
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...mine(), name: 'Alpha, again' } as never);
    choose(0, 'Alpha', 'Edit Title');
    const dialog = screen.getByRole('dialog', { name: 'Edit Title' });
    fireEvent.change(within(dialog).getByLabelText('Post title'), { target: { value: '  Alpha, again ' } });
    fireEvent.click(within(dialog).getByTestId('post-title-save'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/threads/alpha', { name: 'Alpha, again' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Title' })).toBeNull());
    expect(titles()).toEqual(['Alpha, again']);

    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    choose(0, 'Alpha, again', 'Delete Post');
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    expect(del).not.toHaveBeenCalled();
    act(() => useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/threads/alpha'));
    await waitFor(() => expect(screen.queryAllByTestId('forum-post-card')).toHaveLength(0));
  });

  it('moderators pin and lock any post; the pinned one leads the list with its mark, closed ones wear theirs', async () => {
    const rules = withInfo(post('rules', { name: 'Rules', created: '07:00', active: '07:00' }), { pinned: true });
    const done = withInfo(post('done', { name: 'Done', created: '06:00', active: '13:00' }), { archived: true, locked: true });
    served = [ALPHA, BETA, GAMMA, rules, done].map((p) => ({ ...p, spacePermissions: MOD }));
    seed({ bits: MOD, posts: [] });
    renderForum();
    await waitFor(() => expect(titles()).toEqual(['Rules', 'Gamma', 'Alpha', 'Beta', 'Done']));
    const cards = screen.getAllByTestId('forum-post-card');
    expect(within(cards[0]!).getByTestId('post-pinned')).toHaveTextContent('Pinned');
    expect(within(cards[1]!).queryByTestId('post-pinned')).toBeNull();
    expect(within(cards[4]!).getByTestId('post-closed')).toHaveTextContent('Closed');
    expect(within(cards[4]!).getByTestId('post-locked')).toBeInTheDocument();

    expect(itemsOf(openMenu(1, 'Gamma'))).toEqual([
      'Open Post',
      'Follow Post',
      'Close Post',
      'Lock Post',
      'Pin Post',
      'Edit Title',
      'Edit Tags',
      'Copy Link',
      'Delete Post',
    ]);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(withInfo({ ...GAMMA, spacePermissions: MOD }, { pinned: true }) as never);
    choose(1, 'Gamma', 'Pin Post');
    expect(patch).toHaveBeenCalledWith('/api/threads/gamma', { pinned: true });
    expect(itemsOf(openMenu(0, 'Rules'))).toContain('Unpin Post');
    expect(itemsOf(openMenu(4, 'Done'))).toEqual(expect.arrayContaining(['Reopen Post', 'Unlock Post']));
  });

  it('Download saves a post’s file, unless its forum hides downloads (the viewer too)', async () => {
    const pic = first('beta', { type: 'image', text: null, media: upload('img', 'image', 'beta.png') });
    served = [BETA];
    messages = [pic];
    seed({ posts: [] });
    const { unmount } = renderForum();
    await waitFor(() => expect(titles()).toEqual(['Beta']));
    expect(itemsOf(openMenu(0, 'Beta'))).toContain('Download');
    expect(renderHook(() => useHideDownloads('beta')).result.current).toBe(false);
    unmount();

    seed({ forum: info({ media: true, hideDownloads: true }), posts: [] });
    renderForum();
    await waitFor(() => expect(screen.getAllByTestId('forum-media-tile')).toHaveLength(1));
    expect(itemsOf(openMenu(0, 'Beta', 'forum-media-tile'))).not.toContain('Download');
    expect(renderHook(() => useHideDownloads('beta')).result.current).toBe(true);
  });
});

describe('Media channels', () => {
  const media = () => info({ media: true, layout: 'gallery' });

  it('tiles lead with the first picture or video, the title over it; no layout choice', async () => {
    served = [ALPHA, BETA];
    messages = [
      first('alpha', {
        type: 'image',
        text: null,
        media: upload('a1', 'image', 'alpha.png'),
        attachments: [
          { ...upload('a1', 'image', 'alpha.png'), description: 'A red kite' },
          { ...upload('a2', 'image', 'alpha-2.png'), description: null },
        ],
      }),
      first('beta', { type: 'video', text: 'Waves', media: upload('b1', 'video', 'beta.mp4', '/uploads/beta-poster.jpg') }),
    ];
    seed({ forum: media(), posts: [] });
    renderForum();
    await waitFor(() => expect(screen.getAllByTestId('forum-media-tile')).toHaveLength(2));
    expect(screen.queryByTestId('forum-post-card')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Layout/ })).toBeNull();
    const [alpha, beta] = screen.getAllByTestId('forum-media-tile');
    expect(within(alpha!).getByTestId('forum-media-cover')).toHaveAttribute('alt', 'A red kite');
    expect(within(alpha!).getByTestId('forum-media-cover').getAttribute('src')).toContain('/uploads/alpha.png');
    expect(within(alpha!).getByLabelText('2 files')).toBeInTheDocument();
    expect(within(beta!).getByTestId('forum-media-cover').getAttribute('src')).toContain('/uploads/beta-poster.jpg');
    expect(within(beta!).getByLabelText('Video')).toBeInTheDocument();
    expect(within(beta!).getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    fireEvent.click(within(alpha!).getByRole('button', { name: 'Alpha' }));
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'alpha', parentId: 'f1' });
  });

  it('New Post needs a picture or a video; the files go up first, with their alt text', async () => {
    vi.mocked(uploadAll).mockImplementation(async (files) =>
      files.map((f, i) => upload(`up-${i}`, f.file.type.startsWith('video/') ? 'video' : 'image', f.file.name)),
    );
    vi.mocked(api.post).mockImplementation(async (path: string) =>
      (path === '/api/chats/f1/posts' ? post('new1', { name: 'Sunset', created: '14:00', active: '14:00' }) : []) as never,
    );
    served = [];
    seed({ forum: media(), posts: [] });
    renderForum();
    expect(await screen.findByText('No photos or videos yet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('forum-new-post-button'));
    const form = screen.getByRole('form', { name: 'New Post' });
    fireEvent.change(within(form).getByLabelText('Post title'), { target: { value: 'Sunset' } });
    fireEvent.change(within(form).getByLabelText('Post message'), { target: { value: 'At the beach' } });
    expect(within(form).getByTestId('forum-post-submit')).toBeDisabled();
    fireEvent.keyDown(within(form).getByLabelText('Post message'), { key: 'Enter', ctrlKey: true });
    expect(await within(form).findByRole('alert')).toHaveTextContent('Add a picture or a video');

    // Only pictures and videos here.
    const input = within(form).getByTestId('forum-post-file');
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
    expect(within(form).queryAllByTestId('forum-post-file-tile')).toHaveLength(0);
    fireEvent.change(input, {
      target: {
        files: [new File(['v'], 'waves.mp4', { type: 'video/mp4' }), new File(['p'], 'sunset.png', { type: 'image/png' })],
      },
    });
    expect(within(form).getAllByTestId('forum-post-file-tile')).toHaveLength(2);
    fireEvent.change(within(form).getByLabelText('Alt text for sunset.png'), { target: { value: ' An orange sky ' } });
    // A dropped file joins them; removing one takes it out.
    fireEvent.drop(form, { dataTransfer: { types: ['Files'], files: [new File(['q'], 'extra.png', { type: 'image/png' })] } });
    expect(within(form).getAllByTestId('forum-post-file-tile')).toHaveLength(3);
    fireEvent.click(within(form).getByRole('button', { name: 'Remove extra.png' }));
    expect(within(form).getAllByTestId('forum-post-file-tile')).toHaveLength(2);

    fireEvent.click(within(form).getByTestId('forum-post-submit'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/chats/f1/posts', {
        name: 'Sunset',
        text: 'At the beach',
        appliedTags: [],
        clientId: expect.any(String),
        mediaId: 'up-0',
        extraMediaIds: ['up-1'],
        descriptions: [null, 'An orange sky'],
      }),
    );
    expect(vi.mocked(uploadAll).mock.calls[0]![0].map((f) => f.file.name)).toEqual(['waves.mp4', 'sunset.png']);
    await waitFor(() => expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'new1', parentId: 'f1' }));
  });

  it('a forum post takes any file; pictures and videos lead', async () => {
    vi.mocked(uploadAll).mockImplementation(async (files) =>
      files.map((f, i) => ({ ...upload(`up-${i}`, 'image', f.file.name), kind: f.kind === 'visual' ? 'image' : 'file' }) as MediaAttachment),
    );
    seed({ posts: [ALPHA] });
    renderForum();
    fireEvent.click(screen.getByTestId('forum-new-post-button'));
    const form = screen.getByRole('form', { name: 'New Post' });
    fireEvent.change(within(form).getByLabelText('Post title'), { target: { value: 'Report' } });
    fireEvent.paste(within(form).getByLabelText('Post message'), {
      clipboardData: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' }), new File(['p'], 'shot.png', { type: 'image/png' })] },
    });
    expect(within(form).getAllByTestId('forum-post-file-tile')).toHaveLength(2);
    // Only pictures and videos get alt text.
    expect(within(form).queryByLabelText('Alt text for notes.pdf')).toBeNull();
    fireEvent.click(within(form).getByTestId('forum-post-submit'));
    await waitFor(() => expect(uploadAll).toHaveBeenCalled());
    expect(vi.mocked(uploadAll).mock.calls[0]![0].map((f) => [f.file.name, f.kind])).toEqual([
      ['shot.png', 'visual'],
      ['notes.pdf', 'file'],
    ]);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/chats/f1/posts', expect.objectContaining({ mediaId: 'up-0', extraMediaIds: ['up-1'] })),
    );
  });
});

describe('Forum settings', () => {
  it('the Forum tab edits tags, guidelines and options in one save', async () => {
    seed({ forum: info({}, [TAGS[0]!]), bits: MOD });
    const forum = useChats.getState().byId.f1!;
    vi.spyOn(api, 'patch').mockResolvedValue({ ...forum } as never);
    render(
      <MemoryRouter>
        <ChannelDialog spaceId="s1" chat={forum} onClose={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Forum' }));
    const settings = screen.getByTestId('forum-settings');

    fireEvent.click(within(settings).getByRole('button', { name: 'Add Tag' }));
    const rows = within(settings).getAllByTestId('forum-tag-row');
    expect(rows).toHaveLength(2);
    // A tag needs a name before saving.
    fireEvent.click(within(settings).getByTestId('forum-settings-save'));
    expect(await within(settings).findByText('Give the tag a name')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.change(within(rows[1]!).getByLabelText('Tag 2 name'), { target: { value: '  Question ' } });
    fireEvent.click(within(rows[1]!).getByRole('checkbox'));
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Delete tag Bug' }));
    fireEvent.change(within(settings).getByLabelText('Post Guidelines'), { target: { value: 'Be nice' } });
    fireEvent.click(within(settings).getByRole('switch', { name: 'Require tags' }));
    fireEvent.click(within(settings).getByLabelText(/Creation Time/));
    fireEvent.click(within(settings).getByLabelText(/Gallery/));
    fireEvent.click(within(settings).getByTestId('forum-settings-save'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/s1/channels/f1', {
        forumTags: [{ id: expect.any(String), name: 'Question', emoji: null, moderated: true }],
        forumSettings: {
          ...DEFAULT_FORUM_SETTINGS,
          guidelines: 'Be nice',
          requireTag: true,
          defaultSort: 'created',
          layout: 'gallery',
        },
      }),
    );
  });

  it('caps the tags at the forum limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, name: `Tag ${i}`, emoji: null, moderated: false }));
    seed({ forum: info({}, many), bits: MOD });
    render(<ForumSettingsSection spaceId="s1" chat={useChats.getState().byId.f1!} />);
    expect(screen.getByRole('button', { name: 'Add Tag' })).toBeDisabled();
    expect(screen.getByText('Tags (20/20)')).toBeInTheDocument();
  });

  it('the create dialog offers a Forum channel', async () => {
    seed({ bits: MOD });
    vi.mocked(api.post).mockResolvedValue(forumChat() as never);
    render(<MemoryRouter><ChannelDialog spaceId="s1" onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('radio', { name: /Forum/ }));
    fireEvent.change(screen.getByTestId('channel-name'), { target: { value: 'Help Desk' } });
    expect(screen.getByText('Will be #help-desk')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('channel-save'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/spaces/s1/channels', expect.objectContaining({ type: 'space_forum', name: 'help-desk' })),
    );
    expect(vi.mocked(api.post).mock.calls[0]![1]).not.toHaveProperty('forumSettings');
  });

  it('the create dialog offers a Media channel: a forum of pictures and videos, as a grid', async () => {
    seed({ bits: MOD });
    vi.mocked(api.post).mockResolvedValue(forumChat(info({ media: true, layout: 'gallery' })) as never);
    render(<MemoryRouter><ChannelDialog spaceId="s1" onClose={() => {}} /></MemoryRouter>);
    const media = screen.getByRole('radio', { name: /^Media/ });
    expect(media).toHaveTextContent('Share photos and videos');
    fireEvent.click(media);
    expect(media).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^Forum/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.change(screen.getByTestId('channel-name'), { target: { value: 'Photos' } });
    fireEvent.click(screen.getByTestId('channel-save'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/api/spaces/s1/channels',
        expect.objectContaining({ type: 'space_forum', name: 'photos', forumSettings: { media: true, layout: 'gallery' } }),
      ),
    );
  });

  it('a media channel’s settings: hide downloads instead of a layout choice', async () => {
    seed({ forum: info({ media: true, layout: 'gallery' }), bits: MOD });
    const forum = useChats.getState().byId.f1!;
    vi.spyOn(api, 'patch').mockResolvedValue({ ...forum } as never);
    render(
      <MemoryRouter>
        <ChannelDialog spaceId="s1" chat={forum} onClose={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    const settings = screen.getByTestId('forum-settings');
    expect(within(settings).queryByLabelText(/Gallery/)).toBeNull();
    fireEvent.click(within(settings).getByRole('switch', { name: 'Hide media download options' }));
    fireEvent.click(within(settings).getByTestId('forum-settings-save'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/s1/channels/f1', {
        forumTags: TAGS,
        forumSettings: { ...DEFAULT_FORUM_SETTINGS, media: true, layout: 'gallery', hideDownloads: true },
      }),
    );
  });
});

describe('forums store (pure)', () => {
  const filter = (p: Partial<ForumFilter> = {}): ForumFilter => ({ sort: 'activity', tag: null, q: '', ...p });
  const byId = Object.fromEntries([ALPHA, BETA, GAMMA].map((c) => [c.id, c]));

  it('shows the posts down to the last loaded page; all of them once no page is left', () => {
    const f = filter();
    const loaded = (cursor: string | null): ForumList => ({
      key: filterKey(f),
      open: { cursor, loaded: true, loading: false, error: null },
      archived: { cursor: null, loaded: false, loading: false, error: null },
    });
    // Page 1 ended at Alpha (12:00): Beta (11:30) is past it until the next page arrives.
    const cut = selectForumPosts(byId, 'f1', f, loaded(`${ALPHA.lastActivityAt}|${ALPHA.id}`));
    expect(cut.open.map((p) => p.name)).toEqual(['Gamma', 'Alpha']);
    expect(selectForumPosts(byId, 'f1', f, loaded(null)).open.map((p) => p.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
    // Another filter's pages do not cut this one.
    expect(selectForumPosts(byId, 'f1', filter({ sort: 'created' }), loaded(`${ALPHA.lastActivityAt}|${ALPHA.id}`)).open.map((p) => p.name)).toEqual(['Beta', 'Alpha', 'Gamma']);
    // The pinned post leads, however old (the first page brought it).
    const rules = withInfo(post('rules', { name: 'Rules', created: '07:00', active: '07:00' }), { pinned: true });
    const pinned = selectForumPosts({ ...byId, rules }, 'f1', f, loaded(`${ALPHA.lastActivityAt}|${ALPHA.id}`));
    expect(pinned.open.map((p) => p.name)).toEqual(['Rules', 'Gamma', 'Alpha']);
    expect(selectForumPosts({ ...byId, rules }, 'f1', f, loaded(null)).open.map((p) => p.name)).toEqual(['Rules', 'Gamma', 'Alpha', 'Beta']);
  });

  it('filters by tag and title like the server', () => {
    expect(matchesFilter(ALPHA, { tag: 'bug', q: '' })).toBe(true);
    expect(matchesFilter(BETA, { tag: 'bug', q: '' })).toBe(false);
    expect(matchesFilter(ALPHA, { tag: null, q: '  ALP ' })).toBe(true);
    expect(matchesFilter(ALPHA, { tag: null, q: 'beta' })).toBe(false);
  });

  it('a post’s first message: the open window’s, the loaded one, else its last message while it has no reply', () => {
    const known = first('alpha');
    const live = first('alpha', { text: 'edited' });
    expect(firstMessageOf(ALPHA, known, live)).toBe(live);
    expect(firstMessageOf(ALPHA, known, undefined)).toBe(known);
    expect(firstMessageOf(ALPHA, null, undefined)).toBeNull();
    const fresh = { ...ALPHA, lastMessage: first('alpha') };
    expect(firstMessageOf(fresh, undefined, undefined)).toBe(fresh.lastMessage);
    expect(firstMessageOf({ ...ALPHA, lastMessage: first('alpha', { seq: 4 }) }, undefined, undefined)).toBeNull();
  });

  it('my view: my choices over the forum’s defaults; a tag the forum lost is dropped', () => {
    const forum = info({ defaultSort: 'created', layout: 'gallery' });
    expect(viewOf(forum, undefined)).toEqual({ sort: 'created', layout: 'gallery', tag: null, q: '' });
    expect(viewOf(forum, { sort: 'activity', tag: 'gone', q: 'x' })).toEqual({ sort: 'activity', layout: 'gallery', tag: null, q: 'x' });
    expect(viewOf(forum, { tag: 'bug' }).tag).toBe('bug');
  });
});
