/** "Skip to content" and the Home sidebar's navigation landmark and DM list. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VirtuosoMockContext } from 'react-virtuoso';
import { HomeSidebar } from '@/features/home/HomeSidebar';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { SkipToContent } from './SkipToContent';

describe('Skip to content', () => {
  it('is the first tab stop and moves the focus to the main region', () => {
    render(
      <div data-testid="app-base">
        <SkipToContent />
        <nav aria-label="Spaces">
          <button type="button">Home</button>
        </nav>
        <main data-testid="main">
          <button type="button">Chat header</button>
        </main>
      </div>,
    );
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(document.querySelector('a, button')).toBe(link);
    fireEvent.click(link);
    const main = screen.getByTestId('main');
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute('tabindex', '-1');
  });
});

describe('Home sidebar', () => {
  const ann = makeUser({ id: 'ann', displayName: 'Ann' });
  const bob = makeUser({ id: 'bob', displayName: 'Bob' });

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    vi.spyOn(useUsers.getState(), 'subscribePresence').mockResolvedValue();
    vi.spyOn(useUsers.getState(), 'unsubscribePresence').mockReturnValue();
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useChats.setState({
      byId: {
        d1: makeChat({
          id: 'd1',
          type: 'direct',
          peer: ann,
          lastActivityAt: '2026-10-02T00:00:00.000Z',
        }),
        d2: makeChat({
          id: 'd2',
          type: 'direct',
          peer: bob,
          lastActivityAt: '2026-10-01T00:00:00.000Z',
        }),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSessionState();
  });

  it('a navigation landmark around the links and a list of the chats, named by its label', () => {
    render(
      <MemoryRouter initialEntries={['/chats']}>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 42 }}>
          <HomeSidebar />
        </VirtuosoMockContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('complementary', { name: 'Home' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Direct messages' });
    expect(within(nav).getByRole('link', { name: /Friends/ })).toBeInTheDocument();
    const list = within(nav).getByRole('list', { name: 'Direct Messages' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByTestId('dm-row')).toHaveTextContent('Ann');
    expect(within(items[1]!).getByTestId('dm-row')).toHaveTextContent('Bob');
  });
});
