/** The phone tab bar: Servers, Messages, Notifications, You — with their badges. */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { spaceMemory } from '@/features/spaces/actions';
import { makeSpace } from '@/features/spaces/testUtils';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useFriends } from '@/stores/friends';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeMe } from '@/test/factories';
import { BottomTabs } from './BottomTabs';

function renderTabs(path = '/chats') {
  const router = createMemoryRouter([{ path: '*', element: <BottomTabs /> }], {
    initialEntries: [path],
  });
  render(<RouterProvider router={router} />);
}

const tab = (id: string) => screen.getByTestId(`tab-${id}`);

beforeEach(() => {
  useAuth.setState({
    user: makeMe({ id: 'me', username: 'ada', displayName: 'Ada' }),
    token: 't',
    status: 'authenticated',
  });
  useChats.setState({ byId: {}, loaded: true });
  useSpaces.setState({ byId: {}, order: [], loaded: true, channelsLoaded: {} });
  useFriends.setState({ incoming: [], outgoing: [], loaded: true });
});

describe('BottomTabs', () => {
  it('shows the four Discord tabs, Messages current on /chats', () => {
    renderTabs('/chats');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(4);
    ['Servers', 'Messages', 'Notifications', 'You'].forEach((name, i) =>
      expect(links[i]).toHaveAccessibleName(name),
    );
    expect(tab('messages')).toHaveAttribute('aria-current', 'page');
    expect(tab('servers')).not.toHaveAttribute('aria-current');
    expect(tab('notifications')).toHaveAttribute('href', '/notifications');
    expect(tab('you')).toHaveAttribute('href', '/you');
    // You wears my avatar.
    expect(within(tab('you')).getByTestId('you-tab-avatar')).toBeInTheDocument();
  });

  it('marks a tab current on all its pages', () => {
    renderTabs('/updates');
    expect(tab('you')).toHaveAttribute('aria-current', 'page');
    expect(tab('messages')).not.toHaveAttribute('aria-current');
  });

  it('badges each tab from the existing counts', () => {
    useChats.setState({
      byId: {
        d1: makeChat({ id: 'd1', type: 'direct', unreadCount: 2 }),
        d2: makeChat({ id: 'd2', type: 'direct', unreadCount: 1 }),
        g1: makeChat({ id: 'g1', type: 'group', unreadCount: 4, unreadMentionCount: 1 }),
      },
      loaded: true,
    });
    useSpaces.setState({
      byId: { s1: makeSpace({ id: 's1', unreadMentionCount: 2 }) },
      order: ['s1'],
      loaded: true,
      channelsLoaded: {},
    });
    useFriends.setState({ incoming: [{ userId: 'u2', createdAt: '2026-01-01T00:00:00.000Z' }] });
    renderTabs('/chats');

    expect(within(tab('messages')).getByLabelText('3 unread chats')).toHaveTextContent('3');
    expect(within(tab('servers')).getByLabelText('2 unread mentions')).toHaveTextContent('2');
    // The Inbox's mentions: my group (1) and the Space not loaded yet (2).
    expect(within(tab('notifications')).getByLabelText('3 unread mentions')).toHaveTextContent('3');
    expect(within(tab('you')).getByLabelText('1 friend request')).toHaveTextContent('1');
  });

  it('shows no badges when there is nothing new', () => {
    renderTabs('/chats');
    for (const id of ['servers', 'messages', 'notifications', 'you'])
      expect(within(tab(id)).queryByText(/\d/)).toBeNull();
  });

  it('Servers opens the last Space visited', () => {
    useSpaces.setState({
      byId: { s1: makeSpace({ id: 's1' }), s2: makeSpace({ id: 's2' }) },
      order: ['s1', 's2'],
      loaded: true,
      channelsLoaded: {},
    });
    spaceMemory.setLastChannel('s2', 'c9');
    renderTabs('/spaces/s2');
    expect(tab('servers')).toHaveAttribute('href', '/spaces/s2');
    expect(tab('servers')).toHaveAttribute('aria-current', 'page');
  });
});
