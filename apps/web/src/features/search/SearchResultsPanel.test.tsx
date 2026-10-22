import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { MessageSearchPage, MessageSearchResult } from '@enbox/shared';
import { useConversationUi } from '@/features/conversation/state';
import { makeSpace } from '@/features/spaces/testUtils';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSearch } from '@/stores/search';
import { useSidePanel, type SearchScope } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { makeMe, makeMessage, makeUser } from '@/test/factories';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a), post: async () => [] },
}));

const { SearchResultsPanel } = await import('./SearchResultsPanel');
const { ChatSearchDock } = await import('./ChatSearchDock');

const ME = '0190d2a4-3c4b-7d2e-9f10-000000000001';
const ALICE = '0190d2a4-3c4b-7d2e-9f10-00000000000a';
const SPACE = '0190d2a4-3c4b-7d2e-9f10-000000000051';
const GENERAL = '0190d2a4-3c4b-7d2e-9f10-0000000000c1';
const RANDOM = '0190d2a4-3c4b-7d2e-9f10-0000000000c2';
const THREAD = '0190d2a4-3c4b-7d2e-9f10-0000000000c3';
const DM = '0190d2a4-3c4b-7d2e-9f10-0000000000d1';

const alice = makeUser({ id: ALICE, displayName: 'Alice', username: 'alice' });
const spaceScope: SearchScope = { kind: 'space', spaceId: SPACE, channelId: GENERAL };

type Chat = MessageSearchResult['chat'];
const channel = (id: string, name: string): Chat => ({
  id,
  type: 'space_text',
  name,
  avatarUrl: null,
  peer: null,
  spaceId: SPACE,
  parentId: null,
  parentName: null,
});
const thread: Chat = { ...channel(THREAD, 'Quokka facts'), type: 'space_thread', parentId: GENERAL, parentName: 'general' };

let seq = 0;
function result(chat: Chat, text: string): MessageSearchResult {
  seq += 1;
  return {
    chat,
    message: makeMessage({ id: `m-${seq}`, chatId: chat.id, seq, senderId: ALICE, text, createdAt: '2026-10-01T10:00:00.000Z' }),
  };
}

function page(items: MessageSearchResult[], total = items.length, capped = false): MessageSearchPage {
  return { total, capped, items, users: [alice] };
}

function Where() {
  const l = useLocation();
  return <span data-testid="where">{`${l.pathname}${l.search}`}</span>;
}

function renderPanel(scope: SearchScope, query: string, path = `/spaces/${SPACE}/${GENERAL}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/spaces/:spaceId/:chatId"
          element={
            <>
              <SearchResultsPanel scope={scope} query={query} />
              <Where />
            </>
          }
        />
        <Route
          path="/chats/:chatId"
          element={
            <>
              <ChatSearchDock chatId={DM}>
                <div data-testid="conversation-stub" />
              </ChatSearchDock>
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const lastQuery = () => (get.mock.calls.at(-1)?.[1] as { query: Record<string, unknown> }).query;

describe('search results panel', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: ME }), token: 't', status: 'authenticated' });
    useSpaces.setState({ byId: { [SPACE]: makeSpace({ id: SPACE, name: 'Rockets' }) }, order: [SPACE], loaded: true });
  });
  afterEach(() => {
    cleanup();
    get.mockReset();
    resetSessionState();
    useSidePanel.setState({ panel: null });
    useConversationUi.setState({ jump: null });
    useChats.setState({ openChatId: null });
  });

  it('asks the scope for the parsed query, counts the results and groups them by channel', async () => {
    const items = [
      result(channel(GENERAL, 'general'), 'The quokka is happy'),
      result(channel(GENERAL, 'general'), 'another quokka'),
      result(thread, 'quokka in a thread'),
      result(channel(RANDOM, 'random'), 'Quokka elsewhere'),
    ];
    get.mockResolvedValue(page(items, 4));
    renderPanel(spaceScope, `from:${ALICE} has:embed quokka`);
    expect(await screen.findByRole('heading', { name: '4 Results' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/spaces/${SPACE}/messages/search`, expect.anything());
    expect(lastQuery()).toEqual({ q: 'quokka', authorId: ALICE, has: ['link'], sort: 'newest', offset: 0 });

    const groups = screen.getAllByTestId('search-group');
    expect(groups.map((g) => within(g).getByRole('heading').textContent)).toEqual(['general', 'generalQuokka facts', 'random']);
    expect(groups.map((g) => within(g).getAllByTestId('search-result').length)).toEqual([2, 1, 1]);
    // RichText marks the word (no CSS Highlight API in jsdom).
    const first = screen.getAllByTestId('search-result')[0]!;
    expect(within(first).getByText('quokka', { selector: 'mark' })).toBeInTheDocument();
    expect(within(first).getByText('Alice')).toBeInTheDocument();
  });

  it('highlights every word through the CSS Highlight API where there is one', async () => {
    const registry = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal(
      'Highlight',
      class {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    get.mockResolvedValue(page([result(channel(GENERAL, 'general'), 'The Quokka is happy, so happy')]));
    renderPanel(spaceScope, 'happy quokka');
    await screen.findByRole('heading', { name: '1 Result' });
    await waitFor(() => expect(registry.get('enbox-search')?.ranges.map((r) => r.toString())).toEqual(['Quokka', 'happy', 'happy']));
    expect(document.querySelector('mark')).toBeNull();
  });

  it('Jump scrolls the open channel, opens another channel at the message, or a thread beside its channel', async () => {
    const here = result(channel(GENERAL, 'general'), 'quokka here');
    const there = result(channel(RANDOM, 'random'), 'quokka there');
    const inThread = result(thread, 'quokka threaded');
    get.mockResolvedValue(page([here, inThread, there]));
    useChats.setState({ openChatId: GENERAL });
    renderPanel(spaceScope, 'quokka');
    await screen.findByRole('heading', { name: '3 Results' });
    const jumps = () => screen.getAllByRole('button', { name: 'Jump' });

    fireEvent.click(jumps()[0]!);
    expect(useConversationUi.getState().jump).toMatchObject({ chatId: GENERAL, seq: here.message.seq, messageId: here.message.id });
    expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${SPACE}/${GENERAL}`);

    fireEvent.click(jumps()[1]!);
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: THREAD, parentId: GENERAL });
    expect(useConversationUi.getState().jump).toMatchObject({ chatId: THREAD, seq: inThread.message.seq });

    act(() => useSidePanel.getState().open({ kind: 'search', scope: spaceScope, query: 'quokka' }));
    fireEvent.click(jumps()[2]!);
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/spaces/${SPACE}/${RANDOM}?m=${there.message.seq}&mid=${there.message.id}`,
    );
  });

  it('pages through the results and sorts them; a new sort starts at page 1', async () => {
    get.mockImplementation(async () => page([result(channel(GENERAL, 'general'), 'quokka')], 60));
    renderPanel(spaceScope, 'quokka');
    await screen.findByRole('heading', { name: '60 Results' });
    const pager = screen.getByRole('navigation', { name: 'Result pages' });
    expect(within(pager).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Previous', '1', '2', '3', 'Next']);
    expect(within(pager).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(pager).getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 25, sort: 'newest' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Page 3' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
    expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 0, sort: 'oldest' }));
    expect(useSearch.getState().sort).toBe('oldest');
    expect(screen.getByRole('button', { name: 'Oldest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: '60 Results' })).toBeInTheDocument();
  });

  it('shows a skeleton while loading, then the empty state; the close button closes the panel', async () => {
    let resolve!: (p: MessageSearchPage) => void;
    get.mockReturnValue(new Promise<MessageSearchPage>((r) => (resolve = r)));
    useSidePanel.getState().open({ kind: 'search', scope: spaceScope, query: 'nothing' });
    renderPanel(spaceScope, 'nothing');
    expect(screen.getByRole('status', { name: 'Loading results' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Searching…' })).toBeInTheDocument();
    await act(async () => resolve(page([])));
    expect(screen.getByTestId('search-empty')).toHaveTextContent(
      'We searched far and wide. Unfortunately, no results were found.',
    );
    expect(screen.getByRole('heading', { name: '0 Results' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close search results' }));
    expect(useSidePanel.getState().panel).toBeNull();
  });

  it('closes a search of another Space', () => {
    get.mockResolvedValue(page([]));
    const other: SearchScope = { kind: 'space', spaceId: '0190d2a4-3c4b-7d2e-9f10-000000000052' };
    useSidePanel.getState().open({ kind: 'search', scope: other, query: 'x' });
    renderPanel(other, 'x');
    expect(screen.queryByTestId('search-results')).toBeNull();
    expect(useSidePanel.getState().panel).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('DMs: the results dock beside the conversation on desktop, for that chat only', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    get.mockResolvedValue(page([]));
    const dm: SearchScope = { kind: 'chat', chatId: DM };
    useSidePanel.getState().open({ kind: 'search', scope: dm, query: 'hello' });
    renderPanel(dm, 'hello', `/chats/${DM}`);
    expect(screen.getByTestId('conversation-stub')).toBeInTheDocument();
    expect(await screen.findByTestId('search-results')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/chats/${DM}/messages/search`, expect.anything());
    expect(lastQuery()).toEqual({ q: 'hello', sort: 'newest', offset: 0 });
    // No channel headers in a single chat.
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    act(() => useSidePanel.getState().open({ kind: 'search', scope: { kind: 'chat', chatId: GENERAL }, query: 'x' }));
    expect(useSidePanel.getState().panel).toBeNull();
    expect(screen.queryByTestId('search-results')).toBeNull();
  });
});
