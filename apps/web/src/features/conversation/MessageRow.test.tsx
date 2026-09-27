import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { resetSessionState } from '@/lib/session';
import { clearArrivals, markArrival } from '@/lib/arrivals';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext, type RowAppearance } from './bubbles/appearance';
import { CozyMessageRow } from './CozyMessageRow';
import type { Row } from './lib/rows';
import { MessageRow } from './MessageRow';

const me = makeMe({ displayName: 'Mia Me' });
const chat = makeChat({ id: 'chat-a', type: 'group' });

function row(p: Partial<Row> = {}): Row {
  const message = makeMessage({ id: 'm1', chatId: chat.id, senderId: me.id, text: 'hi there' });
  return {
    key: message.id,
    message,
    mine: true,
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
    ...p,
  };
}

function renderRow(
  appearance: Partial<RowAppearance>,
  r: Row = row(),
  Component: typeof MessageRow = MessageRow,
) {
  return render(
    <RowAppearanceContext.Provider
      value={{ bubbleStyle: 'classic', messageAnimation: 'fade', ...appearance }}
    >
      <Component row={r} chat={chat} onJump={() => undefined} onJumpById={() => undefined} />
    </RowAppearanceContext.Provider>,
  );
}

describe('MessageRow bubble styles and enter animations', () => {
  afterEach(() => {
    cleanup();
    clearArrivals();
    resetSessionState();
    useUi.getState().setPref('reduceMotion', 'system');
  });

  it('classic keeps the tail, rounded and minimal drop it', () => {
    useAuth.setState({ user: me });
    renderRow({ bubbleStyle: 'classic' });
    expect(document.querySelector('.msg-tail')).not.toBeNull();
    cleanup();
    renderRow({ bubbleStyle: 'rounded' });
    expect(document.querySelector('.msg-tail')).toBeNull();
    expect(screen.getByTestId('bubble').className).toContain('rounded-[18px]');
    cleanup();
    renderRow({ bubbleStyle: 'minimal' });
    expect(screen.getByTestId('bubble').className).not.toContain('shadow-bubble');
  });

  it('cozy rows show the sender header and no bubble background', () => {
    useAuth.setState({ user: me });
    renderRow({ bubbleStyle: 'cozy' }, row(), CozyMessageRow);
    expect(screen.getByRole('button', { name: 'Profile of Mia Me' })).toBeInTheDocument();
    expect(screen.getByTestId('message')).toHaveAttribute('data-cozy');
    expect(screen.getByTestId('bubble').className).not.toContain('bg-bubble-out');
    cleanup();
    // Later messages of the group carry no header.
    renderRow({ bubbleStyle: 'cozy' }, row({ firstInGroup: false }), CozyMessageRow);
    expect(screen.queryByRole('button', { name: 'Profile of Mia Me' })).not.toBeInTheDocument();
  });

  it('animates a live arrival only, and never under reduced motion', () => {
    useAuth.setState({ user: me });
    renderRow({ messageAnimation: 'slide' });
    expect(screen.getByTestId('bubble').className).not.toContain('animate-msg');
    cleanup();

    markArrival('m1');
    renderRow({ messageAnimation: 'slide' });
    expect(screen.getByTestId('bubble').className).toContain('animate-msg-slide');
    cleanup();

    useUi.getState().setPref('reduceMotion', 'on');
    renderRow({ messageAnimation: 'slide' });
    expect(screen.getByTestId('bubble').className).not.toContain('animate-msg');
  });
});
