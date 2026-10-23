/**
 * The poll card: results hidden until I vote (Show results peeks, Back to voting returns),
 * picking an answer then Vote, my answer checked and Remove vote; the countdown, which flips
 * the poll to closed the moment its end passes; an ended poll's winners and View votes where
 * voters are named; a vote refused because the poll ended meanwhile reads as closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PERM, type ChatSummary, type Poll } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { PollBody } from './PollBody';

const T0 = Date.parse('2026-10-23T10:00:00.000Z');
const HOUR_MS = 60 * 60_000;
const group = makeChat({ id: 'g1', type: 'group' });

const poll = (p: Partial<Poll> = {}): Poll => ({
  question: 'Lunch?',
  options: [
    { id: 'a', text: 'Pizza', emoji: '🍕', voteCount: 2, voterIds: ['olive', 'sam'] },
    { id: 'b', text: 'Sushi', emoji: null, voteCount: 1, voterIds: ['kim'] },
  ],
  allowMultiple: false,
  totalVoters: 3,
  myOptionIds: [],
  endsAt: new Date(Date.now() + 5 * HOUR_MS + 60_000).toISOString(),
  closedAt: null,
  ...p,
});

function seed(p: Poll, chat: ChatSummary = group) {
  const m = makeMessage({
    id: 'p1',
    chatId: chat.id,
    seq: 3,
    type: 'poll',
    text: null,
    senderId: 'olive',
    poll: p,
  });
  useMessages.setState({
    byChat: {
      [chat.id]: {
        items: [m],
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
}

/** The poll as a row renders it: of the live message in the store. */
function Row({ chat = group }: { chat?: ChatSummary }) {
  const live = useMessages((s) => s.byChat[chat.id]?.items[0]);
  return live ? <PollBody m={live} chat={chat} mine={false} /> : null;
}

/** `PUT /vote` answering with the poll as the store holds it (the optimistic result). */
function mockVote() {
  return vi
    .spyOn(api, 'put')
    .mockImplementation(async () => useMessages.getState().byChat.g1!.items[0] as never);
}

const status = () => screen.getByTestId('poll-status');

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
  useUsers.setState({
    byId: Object.fromEntries(
      ['olive', 'sam', 'kim'].map((id) => [id, makeUser({ id, displayName: id })]),
    ),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

describe('PollBody', () => {
  it('hides the results until I vote; Show results peeks and Back to voting returns', () => {
    seed(poll());
    render(<Row />);
    expect(screen.getByRole('group', { name: 'Poll: Lunch?' })).toHaveTextContent(
      'Select one answer',
    );
    expect(screen.getByRole('radio', { name: /Pizza/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('67%')).toBeNull();
    expect(status()).toHaveTextContent('3 votes · 5h left');
    expect(screen.getByRole('button', { name: 'Vote' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(screen.getByRole('listitem', { name: 'Pizza: 2 votes, 67%' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Sushi: 1 vote, 33%' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to voting' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('picking an answer, then Vote sends it; my vote is checked and Remove vote takes it back', async () => {
    seed(poll({ allowMultiple: true }));
    const put = mockVote();
    render(<Row />);
    expect(screen.getByRole('group', { name: 'Poll: Lunch?' })).toHaveTextContent(
      'Select one or more answers',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Sushi/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Pizza/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Pizza/ }));
    expect(screen.getByRole('checkbox', { name: /Sushi/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Pizza/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
    expect(put).toHaveBeenCalledWith('/api/messages/p1/vote', { optionIds: ['b'] });
    expect(
      await screen.findByRole('listitem', { name: 'Sushi: 2 votes, 50%, your vote' }),
    ).toBeInTheDocument();
    expect(status()).toHaveTextContent('4 votes');
    // Voters are named in groups.
    fireEvent.click(screen.getByRole('button', { name: 'View votes' }));
    const details = screen.getByRole('dialog', { name: 'Poll details' });
    expect(details).toHaveTextContent('kim');
    fireEvent.click(within(details).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove vote' }));
    expect(put).toHaveBeenLastCalledWith('/api/messages/p1/vote', { optionIds: [] });
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
    expect(status()).toHaveTextContent('3 votes');
  });

  it('an ended poll shows its results with the winner, and takes no votes', () => {
    seed(poll({ closedAt: new Date().toISOString() }));
    const { unmount } = render(<Row />);
    expect(status()).toHaveTextContent('3 votes · Poll closed');
    const winner = screen.getByRole('listitem', { name: 'Pizza: 2 votes, 67%, winning answer' });
    expect(winner).toHaveAttribute('data-winner', 'true');
    expect(screen.getByRole('listitem', { name: 'Sushi: 1 vote, 33%' })).not.toHaveAttribute(
      'data-winner',
    );
    for (const name of ['Vote', 'Show results', 'Remove vote'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'View votes' })).toBeInTheDocument();
    unmount();

    // Space channels show counts only: no voter list.
    const channel = makeChat({
      id: 'c1',
      type: 'space_text',
      space: { spaceId: 's1', categoryId: null, position: 0, overwrites: [] } as never,
      spacePermissions: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES,
    });
    seed(poll({ closedAt: new Date().toISOString() }), channel);
    render(<Row chat={channel} />);
    expect(screen.getByRole('listitem', { name: /winning answer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View votes' })).toBeNull();
  });

  it('counts down each minute and closes the moment its end passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    seed(poll({ endsAt: new Date(T0 + 150_000).toISOString() }));
    render(<Row />);
    expect(status()).toHaveTextContent('3 votes · 2m left');
    act(() => void vi.advanceTimersByTime(30_001));
    expect(status()).toHaveTextContent('3 votes · 1m left');
    act(() => void vi.advanceTimersByTime(60_000));
    expect(status()).toHaveTextContent('3 votes · <1m left');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(status()).toHaveTextContent('3 votes · Poll closed');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('listitem', { name: /Pizza.*winning answer/ })).toBeInTheDocument();
  });

  it('a vote refused because the poll ended meanwhile shows it closed', async () => {
    seed(poll());
    vi.spyOn(api, 'put').mockRejectedValue(new ApiError('expired', 'This poll has ended', 410));
    render(<Row />);
    fireEvent.click(screen.getByRole('radio', { name: /Pizza/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
    await waitFor(() => expect(status()).toHaveTextContent('3 votes · Poll closed'));
    expect(
      screen.getByRole('listitem', { name: 'Pizza: 2 votes, 67%, winning answer' }),
    ).toBeInTheDocument();
    expect(useUi.getState().toasts.at(-1)?.message).toBe('This poll has ended');
  });
});
