/**
 * Channel mentions: "#" at the caret opens the Space's channels (name prefixes first, sidebar
 * order, with their icons and categories), arrows / Tab / Enter / Escape like the @ list, and a
 * picked channel shows as "#name" in the box and is sent as its `#{id}` token (an edited name
 * goes as plain text). Drafts and edits keep the tokens. Not in DMs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type ChatSummary, type Message, type SpaceChannelInfo } from '@enbox/shared';
import { useDrafts } from '@/features/chats/drafts';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useChatMembersStore } from '../members';
import { useConversationUi } from '../state';
import {
  activeChannelQuery,
  decodeChannels,
  encodeChannels,
  matchChannels,
  pruneChannelRefs,
  sidebarOrder,
} from './channelMentions';
import { Composer } from './Composer';

const GENERAL = '00000000-0000-4000-8000-00000000c001';
const GAMING = '00000000-0000-4000-8000-00000000c002';
const LOUNGE = '00000000-0000-4000-8000-00000000c003';
const NEWS = '00000000-0000-4000-8000-00000000c004';
const SECRET = '00000000-0000-4000-8000-00000000c005';

const VISIBLE = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;

function info(p: Partial<SpaceChannelInfo> = {}): SpaceChannelInfo {
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
    ...p,
  };
}

const channel = (
  id: string,
  name: string,
  p: Partial<ChatSummary> = {},
  s: Partial<SpaceChannelInfo> = {},
) => makeChat({ id, type: 'space_text', name, space: info(s), spacePermissions: VISIBLE, ...p });

const general = channel(GENERAL, 'general', {}, { position: 0 });
const gaming = channel(GAMING, 'gaming', {}, { position: 1, categoryId: 'cat-fun' });
const lounge = channel(
  LOUNGE,
  'Game Lounge',
  { type: 'space_voice' },
  { position: 0, categoryId: 'cat-fun' },
);
const news = channel(NEWS, 'news', {}, { position: 2, isNews: true });
const secret = channel(SECRET, 'gm-secret', { spacePermissions: 0 });

const textarea = () => screen.getByRole('textbox', { name: 'Message' });
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(textarea(), { key });
const list = () => screen.queryByRole('listbox', { name: 'Channels' });
/** Each row's name and category ("gamingFun"). */
const names = () =>
  within(list()!)
    .getAllByRole('option')
    .map((o) => o.textContent);

let send: ReturnType<typeof vi.fn>;
const sentText = (i = 0) => (send.mock.calls[i]![1] as { text?: string }).text;

function seed(items: Message[] = []) {
  useMessages.setState({
    byChat: {
      [GENERAL]: {
        items,
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: {} });
  useChats.setState({
    byId: Object.fromEntries([general, gaming, lounge, news, secret].map((c) => [c.id, c])),
  });
  useSpaces.setState({
    byId: {
      s1: makeSpace({ categories: [{ id: 'cat-fun', name: 'Fun', position: 0, overwrites: [] }] }),
    },
    order: ['s1'],
  });
  seed();
  send = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(useMessages.getState(), 'sendMessage').mockImplementation(send as never);
});

afterEach(() => {
  act(() => useConversationUi.getState().setEditing(GENERAL, null));
  vi.restoreAllMocks();
  resetSessionState();
  useChats.setState({ byId: {} });
  useSpaces.setState({ byId: {}, order: [] });
  useMessages.setState({ byChat: {} });
});

describe('channel mention helpers', () => {
  it('"#" at the start or after a space opens the query; headings and C# do not', () => {
    expect(activeChannelQuery('#', 1)).toEqual({ start: 0, query: '' });
    expect(activeChannelQuery('see #gen', 8)).toEqual({ start: 4, query: 'gen' });
    expect(activeChannelQuery('(#gen', 5)).toEqual({ start: 1, query: 'gen' });
    expect(activeChannelQuery('#Game Lo', 8)).toEqual({ start: 0, query: 'Game Lo' });
    expect(activeChannelQuery('# Title', 7)).toBeNull();
    expect(activeChannelQuery('C#', 2)).toBeNull();
    expect(activeChannelQuery('##', 2)).toBeNull();
  });

  it('encodes picked "#name"s as tokens, longest names first; edited names stay text', () => {
    const refs = [
      { channelId: GAMING, name: 'gaming' },
      { channelId: LOUNGE, name: 'Game Lounge' },
    ];
    expect(encodeChannels('to #gaming, then #Game Lounge!', refs)).toBe(
      `to #{${GAMING}}, then #{${LOUNGE}}!`,
    );
    expect(encodeChannels('#gaming-news and C#gaming', refs)).toBe('#gaming-news and C#gaming');
    expect(encodeChannels('no channels', refs)).toBe('no channels');
  });

  it('decodes the tokens I can see into names (with refs); unknown ones stay tokens', () => {
    const name = (id: string) => (id === GENERAL ? 'general' : null);
    const d = decodeChannels(`in #{${GENERAL}} and #{${SECRET}}`, name);
    expect(d.text).toBe(`in #general and #{${SECRET}}`);
    expect(d.refs).toEqual([{ channelId: GENERAL, name: 'general' }]);
    expect(encodeChannels(d.text, d.refs)).toBe(`in #{${GENERAL}} and #{${SECRET}}`);
    expect(pruneChannelRefs('in #genera', d.refs)).toEqual([]);
  });

  it('matches name and word prefixes first, then anything containing the query', () => {
    const all = [general, gaming, lounge, news];
    expect(matchChannels(all, 'ga').map((c) => c.name)).toEqual(['gaming', 'Game Lounge']);
    expect(matchChannels(all, 'lounge').map((c) => c.name)).toEqual(['Game Lounge']);
    expect(matchChannels(all, 'ew').map((c) => c.name)).toEqual(['news']);
    expect(matchChannels(all, '').length).toBe(4);
  });

  it('orders like the sidebar: uncategorised first, then categories; text before voice', () => {
    const cats = [{ id: 'cat-fun', position: 0 }];
    expect(sidebarOrder([lounge, gaming, news, general], cats).map((c) => c.name)).toEqual([
      'general',
      'news',
      'gaming',
      'Game Lounge',
    ]);
  });
});

describe('"#" in the composer', () => {
  it('lists the Space’s channels I can see, with categories; Enter sends the token', () => {
    render(<Composer chat={general} />);
    type('#');
    expect(names()).toEqual(['general', 'news', 'gamingFun', 'Game LoungeFun']);
    type('#ga');
    expect(names()).toEqual(['gamingFun', 'Game LoungeFun']);
    press('ArrowDown');
    expect(within(list()!).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    press('ArrowUp');
    press('Enter');
    expect(textarea()).toHaveValue('#gaming ');
    expect(list()).toBeNull();
    expect(send).not.toHaveBeenCalled();
    type('#gaming is fun');
    press('Enter');
    expect(sentText()).toBe(`#{${GAMING}} is fun`);
  });

  it('Tab picks too; a name with a space is matched whole', () => {
    render(<Composer chat={general} />);
    type('join #lou');
    press('Tab');
    expect(textarea()).toHaveValue('join #Game Lounge ');
    type('join #Game Lounge now');
    press('Enter');
    expect(sentText()).toBe(`join #{${LOUNGE}} now`);
  });

  it('Escape hides the list until the query changes', () => {
    render(<Composer chat={general} />);
    type('#new');
    expect(names()).toEqual(['news']);
    press('Escape');
    expect(list()).toBeNull();
    // A key up at the same place keeps it hidden.
    fireEvent.keyUp(textarea(), { key: 'Escape' });
    expect(list()).toBeNull();
    type('#news');
    expect(names()).toEqual(['news']);
  });

  it('the trigger nearest the caret wins: "@ann #gam" lists channels', () => {
    render(<Composer chat={general} />);
    type('hey @ann #gam');
    expect(names()).toEqual(['gamingFun', 'Game LoungeFun']);
    expect(screen.queryByRole('listbox', { name: 'Mention someone' })).toBeNull();
  });

  it('an edited channel name is sent as plain text', () => {
    render(<Composer chat={general} />);
    type('#gam');
    press('Enter');
    type('#gamingx');
    press('Enter');
    expect(sentText()).toBe('#gamingx');
  });

  it('drafts keep the token, and come back as the name', () => {
    const { unmount } = render(<Composer chat={general} />);
    type('#gam');
    press('Enter');
    expect(useDrafts.getState().byChat[GENERAL]?.text).toBe(`#{${GAMING}} `);
    unmount();
    render(<Composer chat={general} />);
    expect(textarea()).toHaveValue('#gaming ');
    press('Enter');
    expect(sentText()).toBe(`#{${GAMING}}`);
  });

  it('editing shows a message’s channels by name and saves their tokens', () => {
    const m = makeMessage({ id: 'm1', chatId: GENERAL, senderId: 'me', text: `see #{${NEWS}}` });
    seed([m]);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(m as never);
    render(<Composer chat={general} />);
    act(() => useConversationUi.getState().setEditing(GENERAL, m));
    expect(textarea()).toHaveValue('see #news');
    type('see #news now');
    press('Enter');
    expect(patch).toHaveBeenCalledWith('/api/messages/m1', { text: `see #{${NEWS}} now` });
  });

  it('DMs have no channel list', () => {
    const dm = makeChat({ id: 'dm1', type: 'direct', peer: makeUser({ id: 'olive' }) });
    render(<Composer chat={dm} />);
    type('#ga');
    expect(list()).toBeNull();
  });
});
