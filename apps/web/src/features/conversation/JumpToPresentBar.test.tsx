/** Discord's "You're viewing older messages / Jump to Present" bar over the message list. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext } from './bubbles/appearance';
import { JumpToPresentBar } from './Bars';
import { MessageList } from './MessageList';

const chat = makeChat({ id: 'g1', type: 'group' });

function renderList(hasMoreAfter: boolean) {
  useAuth.setState({ user: makeMe({ id: 'me' }) });
  useMessages.setState({
    byChat: {
      g1: {
        items: [makeMessage({ id: 'm1', chatId: 'g1', seq: 1, senderId: 'olive' })],
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter,
      } as unknown as ChatMessages,
    },
  });
  return render(
    <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'fade' }}>
      <MessageList chat={chat} unread={null} initialTarget={null} />
    </RowAppearanceContext.Provider>,
  );
}

afterEach(() => {
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

describe('Jump to Present', () => {
  it('says so and jumps', () => {
    const onJump = vi.fn();
    render(<JumpToPresentBar onJump={onJump} />);
    expect(screen.getByText('You’re viewing older messages')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Present' }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('shows over the list while the newest messages aren’t loaded', () => {
    const { unmount } = renderList(true);
    expect(screen.getByTestId('jump-to-present')).toBeInTheDocument();
    unmount();
    renderList(false);
    expect(screen.queryByTestId('jump-to-present')).toBeNull();
  });
});
