/**
 * Polls with an end on the web: the duration labels and the countdown, who gets End Poll Now
 * (it asks first, then closes the poll in the store) and the result card (the winner with its
 * share, a tie, no votes; View Poll jumps to the poll, loading around it when needed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PERM,
  POLL_DURATIONS_HOURS,
  type ChatSummary,
  type Message,
  type Poll,
  type SystemEvent,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useConversationUi } from '../../state';
import { nextTickIn, pollDurationLabel, pollEnded, timeLeftLabel, winningOptionIds } from './model';
import { pollMenuItem } from './pollMenu';
import { PollResultCard } from './PollResultCard';

type PollResult = Extract<SystemEvent, { kind: 'poll_result' }>;

const T0 = Date.parse('2026-10-23T10:00:00.000Z');
const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.SEND_POLLS;
const MOD = MEMBER | PERM.MANAGE_MESSAGES;

const space = {
  spaceId: 's1',
  categoryId: null,
  position: 0,
  overwrites: [],
} as unknown as NonNullable<ChatSummary['space']>;
const group = makeChat({ id: 'g1', type: 'group' });
const spaceChannel = (bits: number) =>
  makeChat({ id: 'c1', type: 'space_text', name: 'general', space, spacePermissions: bits });

const poll = (p: Partial<Poll> = {}): Poll => ({
  question: 'Lunch?',
  options: [
    { id: 'a', text: 'Pizza', emoji: '🍕', voteCount: 2, voterIds: [] },
    { id: 'b', text: 'Sushi', emoji: null, voteCount: 1, voterIds: [] },
  ],
  allowMultiple: false,
  totalVoters: 3,
  endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  closedAt: null,
  ...p,
});

const pollMessage = (p: Partial<Message> = {}) =>
  makeMessage({
    id: 'p1',
    chatId: 'g1',
    seq: 4,
    type: 'poll',
    text: null,
    senderId: 'me',
    poll: poll(),
    ...p,
  });

function seed(chat: Pick<ChatSummary, 'id'>, items: Message[]) {
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
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
  useUsers.setState({ byId: { olive: makeUser({ id: 'olive', displayName: 'Olive' }) } });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

describe('poll helpers', () => {
  it('labels every duration and counts down like Discord', () => {
    expect(POLL_DURATIONS_HOURS.map(pollDurationLabel)).toEqual([
      '1 hour',
      '4 hours',
      '8 hours',
      '24 hours',
      '3 days',
      '1 week',
      '2 weeks',
    ]);
    const at = (ms: number) => new Date(T0 + ms).toISOString();
    expect(timeLeftLabel(at((72 + 1) * 60 * 60_000), T0)).toBe('3d left');
    expect(timeLeftLabel(at(5.5 * 60 * 60_000), T0)).toBe('5h left');
    expect(timeLeftLabel(at(12 * 60_000 + 59_000), T0)).toBe('12m left');
    expect(timeLeftLabel(at(30_000), T0)).toBe('<1m left');
    // The next tick lands just past the next minute of the countdown; none once it ended.
    expect(nextTickIn(at(150_000), T0)).toBe(30_001);
    expect(nextTickIn(at(-1), T0)).toBe(0);
  });

  it('a poll ended when closed or once its end passed; winners are the top answers', () => {
    expect(pollEnded({ endsAt: null, closedAt: null })).toBe(false);
    expect(pollEnded({ endsAt: new Date(T0 + 1).toISOString(), closedAt: null }, T0)).toBe(false);
    expect(pollEnded({ endsAt: new Date(T0).toISOString(), closedAt: null }, T0)).toBe(true);
    expect(pollEnded({ endsAt: null, closedAt: new Date(T0).toISOString() }, T0)).toBe(true);
    expect([...winningOptionIds(poll())]).toEqual(['a']);
    const tie = poll({ options: poll().options.map((o) => ({ ...o, voteCount: 1 })) });
    expect([...winningOptionIds(tie)]).toEqual(['a', 'b']);
    const none = poll({ options: poll().options.map((o) => ({ ...o, voteCount: 0 })) });
    expect(winningOptionIds(none).size).toBe(0);
  });
});

describe('End Poll Now', () => {
  it('is offered to the sender, a Space moderator or a broadcast channel’s admins while the poll is open', () => {
    const label = (chat: ChatSummary, m: Message) => pollMenuItem(chat, m, 'me')?.label ?? null;
    const mine = pollMessage();
    const theirs = pollMessage({ senderId: 'olive' });
    expect(label(group, mine)).toBe('End Poll Now');
    expect(label(group, theirs)).toBeNull();
    expect(label(spaceChannel(MOD), { ...theirs, chatId: 'c1' })).toBe('End Poll Now');
    expect(label(spaceChannel(MEMBER), { ...theirs, chatId: 'c1' })).toBeNull();
    // Broadcast channels post as the channel: its admins end its polls.
    const post = { ...theirs, senderId: null };
    expect(label(makeChat({ type: 'channel', myRole: 'admin' }), post)).toBe('End Poll Now');
    expect(label(makeChat({ type: 'channel', myRole: 'member' }), post)).toBeNull();
    // Not once it ended (closed, or its time ran out), nor for deleted, unsent or other messages.
    const closed = poll({ closedAt: new Date().toISOString() });
    expect(label(group, pollMessage({ poll: closed }))).toBeNull();
    const ranOut = poll({ endsAt: new Date(Date.now() - 1000).toISOString() });
    expect(label(group, pollMessage({ poll: ranOut }))).toBeNull();
    expect(label(group, pollMessage({ deletedAt: new Date().toISOString() }))).toBeNull();
    expect(label(group, pollMessage({ id: 'local:c1' }))).toBeNull();
    expect(label(group, makeMessage({ senderId: 'me' }))).toBeNull();
    expect(label({ ...group, membership: 'left' }, mine)).toBeNull();
  });

  it('asks first, then closes the poll for everyone', async () => {
    const m = pollMessage();
    seed(group, [m]);
    const closedAt = new Date().toISOString();
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ ...m, poll: { ...m.poll!, closedAt } } as never);
    pollMenuItem(group, m, 'me')!.onSelect!();
    let dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('End poll now?');
    act(() => useUi.getState().closeDialog(dialog.id, 'cancel'));
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();

    pollMenuItem(group, m, 'me')!.onSelect!();
    dialog = useUi.getState().dialogs[0]!;
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/messages/p1/poll/end'));
    await waitFor(() =>
      expect(useMessages.getState().byChat.g1!.items[0]!.poll!.closedAt).toBe(closedAt),
    );
  });
});

describe('PollResultCard', () => {
  const result = (p: Partial<PollResult> = {}): PollResult => ({
    kind: 'poll_result',
    pollMessageId: 'p1',
    authorId: 'olive',
    question: 'Lunch?',
    totalVoters: 3,
    winners: [{ optionId: 'a', text: 'Pizza', emoji: '🍕', votes: 2 }],
    ...p,
  });
  const card = (event: PollResult, onJump?: (id: string) => void) => {
    const m = makeMessage({ id: 'r1', chatId: 'g1', seq: 9, type: 'system', system: event });
    return render(<PollResultCard m={m} event={event} onJump={onJump} />);
  };

  it('names who asked, the winning answer with its emoji and share', () => {
    card(result());
    const el = screen.getByTestId('poll-result-card');
    expect(el).toHaveTextContent('Olive’s poll Lunch? has closed');
    expect(el).toHaveTextContent('🍕');
    expect(el).toHaveTextContent('Pizza· Winning answer · 67%');
  });

  it('my own poll, a tie, nobody voting', () => {
    const { unmount } = card(result({ authorId: 'me' }));
    expect(screen.getByTestId('poll-result-card')).toHaveTextContent('Your poll Lunch? has closed');
    unmount();
    const tie = result({
      winners: [
        { optionId: 'a', text: 'Pizza', emoji: '🍕', votes: 1 },
        { optionId: 'b', text: 'Sushi', emoji: null, votes: 1 },
      ],
      totalVoters: 2,
    });
    const second = card(tie);
    expect(screen.getByTestId('poll-result-card')).toHaveTextContent('It’s a tie · Pizza, Sushi');
    second.unmount();
    card(result({ authorId: null, totalVoters: 0, winners: [] }));
    const el = screen.getByTestId('poll-result-card');
    expect(el).toHaveTextContent('A poll Lunch? has closed');
    expect(el).toHaveTextContent('No one voted');
  });

  it('View Poll jumps to a loaded poll, or loads around one that is not', async () => {
    seed(group, [pollMessage()]);
    const onJump = vi.fn();
    const { unmount } = card(result(), onJump);
    fireEvent.click(screen.getByRole('button', { name: 'View Poll' }));
    expect(onJump).toHaveBeenCalledWith('p1');
    unmount();

    const get = vi.spyOn(api, 'get').mockResolvedValue(pollMessage({ id: 'p0', seq: 2 }) as never);
    card(result({ pollMessageId: 'p0' }), onJump);
    fireEvent.click(screen.getByRole('button', { name: 'View Poll' }));
    expect(get).toHaveBeenCalledWith('/api/messages/p0');
    await waitFor(() =>
      expect(useConversationUi.getState().jump).toMatchObject({
        chatId: 'g1',
        seq: 2,
        messageId: 'p0',
      }),
    );
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});
