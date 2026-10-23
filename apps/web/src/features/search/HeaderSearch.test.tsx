import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatMember, SpaceMember } from '@enbox/shared';
import { useChatMembersStore } from '@/features/conversation/members';
import { makeSpace } from '@/features/spaces/testUtils';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSearch } from '@/stores/search';
import { useSidePanel, type SearchScope } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { formatDay } from './query';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a), post: async () => [] },
}));

const { SearchBox } = await import('./SearchBox');

const ME = '0190d2a4-3c4b-7d2e-9f10-000000000001';
const ALICE = '0190d2a4-3c4b-7d2e-9f10-00000000000a';
const DM = '0190d2a4-3c4b-7d2e-9f10-0000000000d1';
const SPACE = '0190d2a4-3c4b-7d2e-9f10-000000000051';
const GENERAL = '0190d2a4-3c4b-7d2e-9f10-0000000000c1';
const VOICE = '0190d2a4-3c4b-7d2e-9f10-0000000000c2';

const alice = makeUser({ id: ALICE, displayName: 'Alice', username: 'alice' });
const dmScope: SearchScope = { kind: 'chat', chatId: DM };
const spaceScope: SearchScope = { kind: 'space', spaceId: SPACE, channelId: GENERAL };

function member(user: ReturnType<typeof makeUser>): ChatMember {
  return { user, role: 'member', joinedAt: '2026-01-01T00:00:00.000Z' };
}

function spaceChannel(id: string, name: string, type: 'space_text' | 'space_voice') {
  const c = makeChat({ id, name, type, spacePermissions: 1 });
  return {
    ...c,
    space: {
      spaceId: SPACE,
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

function renderBox(scope: SearchScope, props: { shortcut?: boolean } = {}) {
  render(<SearchBox scope={scope} placeholder="Search" {...props} />);
  return screen.getByRole('combobox', { name: 'Search messages' }) as HTMLInputElement;
}

const chips = () => screen.queryAllByTestId('search-chip').map((c) => c.textContent);
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });

describe('header search box', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: ME, displayName: 'Me', username: 'me' }), token: 't', status: 'authenticated' });
    useUsers.setState({ byId: { [ALICE]: alice } });
    useChats.setState({
      byId: {
        [DM]: makeChat({ id: DM, type: 'direct', name: null, peer: alice, memberCount: 2 }),
        [GENERAL]: spaceChannel(GENERAL, 'general', 'space_text'),
        [VOICE]: spaceChannel(VOICE, 'Lounge', 'space_voice'),
      },
    });
    useChatMembersStore.setState({
      byChat: { [DM]: [member(makeUser({ id: ME, displayName: 'Me', username: 'me' })), member(alice)] },
    });
    useSpaces.setState({ byId: { [SPACE]: makeSpace({ id: SPACE, name: 'Rockets' }) }, order: [SPACE], loaded: true, channelsLoaded: { [SPACE]: true } });
  });
  afterEach(() => {
    cleanup();
    get.mockReset();
    resetSessionState();
    useSidePanel.setState({ panel: null });
  });

  it('shows the search options on focus (in: only in Spaces) and narrows them while typing', () => {
    const input = renderBox(dmScope);
    act(() => input.focus());
    const list = screen.getByRole('listbox', { name: 'Search options' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'from: user',
      'mentions: user',
      'has: link, embed or file',
      'before: specific date',
      'during: specific date',
      'after: specific date',
      'pinned: true or false',
    ]);
    type(input, 'ha');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['has: link, embed or file']);
    // Picking a key inserts it and keeps typing there.
    fireEvent.click(screen.getByRole('option'));
    expect(input.value).toBe('has:');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'link',
      'embed',
      'file',
      'video',
      'image',
      'sound',
      'poll',
    ]);
  });

  it('from: lists the chat members; Enter picks the first one as a chip, then runs the search', () => {
    const input = renderBox(dmScope);
    act(() => input.focus());
    type(input, 'from:al');
    const option = screen.getByRole('option', { name: /Alice/ });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chips()).toEqual(['from:Alice']);
    expect(input.value).toBe('');
    expect(useSidePanel.getState().panel).toBeNull();

    type(input, 'quokka');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSidePanel.getState().panel).toEqual({ kind: 'search', scope: dmScope, query: `from:${ALICE} quokka` });
    expect(useSearch.getState().recents[`chat:${DM}`]).toEqual([`from:${ALICE} quokka`]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('in a Space, people come from the member search and in: lists the text channels', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === `/api/spaces/${SPACE}/members`)
        return { members: [{ userId: ALICE, nickname: 'Ally', roleIds: [], joinedAt: '2026-01-01T00:00:00.000Z' } as unknown as SpaceMember], nextCursor: null };
      throw new Error(`unexpected ${url}`);
    });
    const input = renderBox(spaceScope);
    act(() => input.focus());
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('in: channel');
    type(input, 'mentions:al');
    fireEvent.click(await screen.findByRole('option', { name: /Ally/ }));
    expect(get).toHaveBeenCalledWith(`/api/spaces/${SPACE}/members`, { query: { q: 'al', limit: 8 } });
    expect(chips()).toEqual(['mentions:Ally']);

    type(input, 'in:');
    // Voice channels too (their text chat).
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['general', 'Lounge']);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(chips()).toEqual(['mentions:Ally', 'in:#general']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSidePanel.getState().panel).toEqual({
      kind: 'search',
      scope: spaceScope,
      query: `mentions:${ALICE} in:${GENERAL}`,
    });
  });

  it('has: and dates become chips; Backspace removes the last chip; Esc clears and closes the results', () => {
    const input = renderBox(dmScope);
    act(() => input.focus());
    type(input, 'has:');
    fireEvent.click(screen.getByRole('option', { name: 'image' }));
    expect(chips()).toEqual(['has:image']);

    type(input, 'before:');
    expect(screen.getAllByRole('option').map((o) => o.textContent?.replace(/\d{4}-\d{2}-\d{2}/, 'D'))).toEqual([
      'TodayD',
      'YesterdayD',
      'Pick a date',
    ]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chips()).toEqual(['has:image', `before:${formatDay(new Date())}`]);

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(chips()).toEqual(['has:image']);

    // Typed filters become chips when the search runs.
    type(input, 'pinned:true cats');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(chips()).toEqual([]);
    expect(input.value).toBe('');

    type(input, 'has:link dogs');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chips()).toEqual(['has:link']);
    expect(input.value).toBe('dogs');
    expect(useSidePanel.getState().panel).toMatchObject({ kind: 'search', query: 'has:link dogs' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(chips()).toEqual([]);
    expect(useSidePanel.getState().panel).toBeNull();
  });

  it('runs a recent search from the history', () => {
    useSearch.setState({ recents: { [`chat:${DM}`]: [`from:${ALICE} hello`] } });
    const input = renderBox(dmScope);
    act(() => input.focus());
    const history = screen.getByRole('group', { name: 'History' });
    fireEvent.click(within(history).getByRole('option', { name: /hello/ }));
    expect(useSidePanel.getState().panel).toEqual({ kind: 'search', scope: dmScope, query: `from:${ALICE} hello` });
    expect(chips()).toEqual(['from:Alice']);
    expect(input.value).toBe('hello');
  });

  it('Ctrl+F focuses the box', () => {
    const input = renderBox(dmScope, { shortcut: true });
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });
});
