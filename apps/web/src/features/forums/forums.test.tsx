/**
 * Forum UI: the post list (order by activity or creation, cards with tags, preview, author,
 * counts, gallery covers), the tag filter, the guidelines, the New Post flow (tags, required
 * tags, moderated tags, the post opening beside the forum), the `?thread=` link, the Forum
 * settings tab (tags editor and options), the Forum type of the create dialog, and the
 * store's pure helpers (window of loaded pages, filters, first messages, views).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  DEFAULT_FORUM_SETTINGS,
  PERM,
  type ChatSummary,
  type ForumInfo,
  type ForumPostsPage,
  type ForumSettings,
  type ForumTag,
  type Message,
} from '@enbox/shared';
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
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { ForumChannelView } from './ForumChannelView';
import { ForumSettingsSection } from './ForumSettingsSection';

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
  useThreads.setState({ lists: {}, draft: null, recent: [], starters: {} });
  useForums.setState({ lists: {}, firstMessages: {}, views: {} });
  useSidePanel.setState({ panel: null });
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
