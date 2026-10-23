import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { resetSessionState } from '@/lib/session';
import { makeMessage } from '@/test/factories';
import { BookmarkMark } from './BookmarkMark';
import { useBookmarks } from './store';

describe('BookmarkMark', () => {
  afterEach(() => resetSessionState());

  it('shows while the message is bookmarked', () => {
    render(<BookmarkMark messageId="m1" />);
    expect(screen.queryByTestId('bookmark-mark')).toBeNull();
    act(() =>
      useBookmarks.getState().upsert({
        messageId: 'm1',
        chatId: 'c1',
        createdAt: '2026-10-23T10:00:00.000Z',
        remindAt: null,
        remindedAt: null,
        message: makeMessage({ id: 'm1' }),
      }),
    );
    expect(screen.getByTestId('bookmark-mark')).toHaveTextContent('Bookmarked');
    act(() => useBookmarks.getState().remove('m1'));
    expect(screen.queryByTestId('bookmark-mark')).toBeNull();
  });
});
