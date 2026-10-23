/**
 * Composer keyboard: the slash command list (`/` at the start; arrows, Tab / Enter pick,
 * Escape hides) and its transforms on send, ↑ in an empty composer edits my last message
 * (Escape cancels), and the reply's "@ ON / @ OFF" (OFF sends `mentionRepliedAuthor: false`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatSummary, Message } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { Composer } from '../composer/Composer';
import { useChatMembersStore } from '../members';
import { useConversationUi } from '../state';
import { SHRUG } from './commands';

const group = makeChat({ id: 'g1', type: 'group', name: 'Friends' });
const dm = makeChat({
  id: 'dm1',
  type: 'direct',
  peer: makeUser({ id: 'olive', displayName: 'Olive' }),
});

const textarea = () => screen.getByRole('textbox', { name: 'Message' });
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(textarea(), { key, ...init });
const options = () =>
  within(screen.getByRole('listbox', { name: 'Commands' }))
    .getAllByRole('option')
    .map((o) => o.textContent?.match(/^\/\w+/)?.[0]);

let send: ReturnType<typeof vi.fn>;

function seed(chat: ChatSummary, items: Message[] = []) {
  useMessages.setState({
    byChat: {
      [chat.id]: {
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
  useChatMembersStore.setState({ byChat: { g1: [], dm1: [] } });
  send = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(useMessages.getState(), 'sendMessage').mockImplementation(send as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

const sentText = (i = 0) => (send.mock.calls[i]![1] as { text?: string }).text;

describe('slash commands in the composer', () => {
  it('“/” at the start lists the built-in commands; arrows move, Tab picks', () => {
    seed(group);
    render(<Composer chat={group} />);
    type('/');
    expect(options()).toEqual(['/shrug', '/tableflip', '/unflip', '/me', '/spoiler']);
    type('/s');
    expect(options()).toEqual(['/shrug', '/spoiler']);
    press('ArrowDown');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    press('Tab');
    expect(textarea()).toHaveValue('/spoiler ');
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('Enter picks a command; sending applies it (/shrug, /tableflip …)', () => {
    seed(group);
    render(<Composer chat={group} />);
    type('/sh');
    press('Enter');
    expect(textarea()).toHaveValue('/shrug ');
    expect(send).not.toHaveBeenCalled();
    type('/shrug oh well');
    press('Enter');
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentText()).toBe(`oh well ${SHRUG}`);
    expect(textarea()).toHaveValue('');
  });

  it('/me is italic, /spoiler a spoiler; a missing message sends nothing', () => {
    seed(group);
    render(<Composer chat={group} />);
    type('/me waves');
    press('Enter');
    expect(sentText(0)).toBe('_waves_');
    type('/spoiler the ending');
    press('Enter');
    expect(sentText(1)).toBe('||the ending||');
    type('/spoiler ');
    press('Enter');
    expect(send).toHaveBeenCalledTimes(2);
    expect(useUi.getState().toasts.at(-1)?.message).toBe('Type a message after /spoiler');
    // Not a command: sent as typed.
    type('/nothing here');
    press('Enter');
    expect(sentText(2)).toBe('/nothing here');
  });

  it('Escape hides the list until the text changes', () => {
    seed(group);
    render(<Composer chat={group} />);
    type('/t');
    expect(options()).toEqual(['/tableflip']);
    press('Escape');
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull();
    type('/ta');
    expect(options()).toEqual(['/tableflip']);
  });
});

describe('composer keys', () => {
  it('↑ in an empty composer edits my last message; Escape cancels', () => {
    const now = new Date().toISOString();
    const mine = makeMessage({
      id: 'm2',
      chatId: 'g1',
      seq: 2,
      senderId: 'me',
      text: 'my last one',
      createdAt: now,
    });
    seed(group, [
      makeMessage({
        id: 'm1',
        chatId: 'g1',
        seq: 1,
        senderId: 'me',
        text: 'older',
        createdAt: now,
      }),
      mine,
      makeMessage({
        id: 'm3',
        chatId: 'g1',
        seq: 3,
        senderId: 'olive',
        text: 'theirs',
        createdAt: now,
      }),
    ]);
    render(<Composer chat={group} />);
    press('ArrowUp');
    expect(useConversationUi.getState().editing.g1?.id).toBe('m2');
    expect(textarea()).toHaveValue('my last one');
    press('Escape');
    expect(useConversationUi.getState().editing.g1).toBeUndefined();
    expect(textarea()).toHaveValue('');
    // Not with text in the field.
    type('draft');
    press('ArrowUp');
    expect(useConversationUi.getState().editing.g1).toBeUndefined();
  });

  it('a reply pings its author by default; @ OFF sends mentionRepliedAuthor: false', () => {
    const theirs = makeMessage({
      id: 'm9',
      chatId: 'g1',
      seq: 9,
      senderId: 'olive',
      text: 'question?',
    });
    seed(group, [theirs]);
    render(<Composer chat={group} />);
    act(() => useConversationUi.getState().setReply('g1', theirs));
    const toggle = screen.getByRole('button', { name: '@ ON' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '@ OFF' })).toHaveAttribute('aria-pressed', 'false');
    type('quiet answer');
    press('Enter');
    expect(send.mock.calls[0]![1]).toMatchObject({
      type: 'text',
      text: 'quiet answer',
      replyToId: 'm9',
      mentionRepliedAuthor: false,
    });

    // A new reply starts at @ ON again, and sends no flag.
    act(() => useConversationUi.getState().setReply('g1', theirs));
    expect(screen.getByRole('button', { name: '@ ON' })).toBeInTheDocument();
    type('loud answer');
    press('Enter');
    expect(send.mock.calls[1]![1]).toMatchObject({ text: 'loud answer', replyToId: 'm9' });
    expect(send.mock.calls[1]![1]).not.toHaveProperty('mentionRepliedAuthor');
  });

  it('no @ toggle on replies to myself or in direct chats', () => {
    const mineMsg = makeMessage({ id: 'm1', chatId: 'g1', seq: 1, senderId: 'me', text: 'mine' });
    seed(group, [mineMsg]);
    const { unmount } = render(<Composer chat={group} />);
    act(() => useConversationUi.getState().setReply('g1', mineMsg));
    expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^@ O/ })).toBeNull();
    unmount();

    const theirs = makeMessage({ id: 'd1', chatId: 'dm1', seq: 1, senderId: 'olive', text: 'hi' });
    seed(dm, [theirs]);
    render(<Composer chat={dm} />);
    act(() => useConversationUi.getState().setReply('dm1', theirs));
    expect(screen.queryByRole('button', { name: /^@ O/ })).toBeNull();
  });
});
